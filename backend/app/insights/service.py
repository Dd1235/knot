"""AI insights: observations about spending, grounded in computed facts.

The division of labour is deliberate and matches the rest of the app — SQL and
Python do every calculation, the model only turns already-true facts into
sentences. A model that is never asked to do arithmetic cannot get arithmetic
wrong.

Generated insights are written back as episodic `insight` events, so the
agent can recall its own past observations in conversation.
"""

import json
import logging
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from psycopg.rows import dict_row

from app.db.pool import pool
from app.ledger import analytics, recurring
from app.llm.provider import get_provider
from app.memory import episodic

log = logging.getLogger(__name__)

# Only comment on categories with enough money in them to matter.
MATERIAL_SPEND = Decimal("100")
# A category has to move this much before it is worth a sentence.
NOTABLE_CHANGE_PCT = 25.0

SYSTEM = """You are Knot, a personal finance agent. You are given ALREADY-COMPUTED
facts about one user's spending. Turn them into 2-4 short observations.

Rules:
- NEVER compute or invent a number. Use only the numbers given, verbatim.
- Each observation: one sentence, plain and specific, no hedging, no preamble.
- Prefer what is actionable or surprising over what is obvious.
- Indian context: ₹ with Indian digit grouping.
- If the facts are thin, return fewer observations. An empty list is fine.

Return STRICT JSON only, no prose or code fences:
{"insights": [{"kind": "anomaly|pattern|commitment|win", "text": "<one sentence>"}]}"""


def _pct_change(current: Decimal, prior: Decimal) -> float | None:
    if prior == 0:
        return None
    return float(round((current - prior) / prior * 100, 1))


async def _compute_facts(user_handle: str, days: int) -> dict:
    """Everything the model is allowed to talk about, computed here."""
    current = await analytics.summary(user_handle, days)
    prior = await analytics.summary(user_handle, days, offset_days=days)
    commitments = await recurring.list_commitments(user_handle)

    prior_by_category = {c["category"]: Decimal(c["amount"]) for c in prior["by_category"]}
    movers = []
    for row in current["by_category"]:
        amount = Decimal(row["amount"])
        if amount < MATERIAL_SPEND:
            continue
        was = prior_by_category.get(row["category"], Decimal("0"))
        change = _pct_change(amount, was)
        if change is None:
            movers.append(
                {
                    "category": row["category"],
                    "group": row["grp"],
                    "amount": str(amount),
                    "note": "new this period — nothing spent here in the prior period",
                }
            )
        elif abs(change) >= NOTABLE_CHANGE_PCT:
            movers.append(
                {
                    "category": row["category"],
                    "group": row["grp"],
                    "amount": str(amount),
                    "prior_amount": str(was),
                    "change_pct": change,
                    "direction": "up" if change > 0 else "down",
                }
            )

    total_spend = Decimal(current["total_spend"])
    committed = Decimal(commitments["monthly_total"])
    return {
        "window_days": days,
        "total_spend": current["total_spend"],
        "prior_total_spend": prior["total_spend"],
        "total_spend_change_pct": _pct_change(total_spend, Decimal(prior["total_spend"])),
        "total_income": current["total_income"],
        "net_cashflow": current["net_cashflow"],
        "net_worth": current["net_worth"]["net_worth"],
        "by_group": current["by_group"],
        "movers": movers,
        "monthly_committed": commitments["monthly_total"],
        # Prorate: `committed` is a monthly figure, `total_spend` covers `days`.
        "committed_share_of_spend": (
            float(round(committed * Decimal(days) / 30 / total_spend * 100, 1))
            if total_spend > 0
            else None
        ),
        "active_commitments": [
            {"name": c["name"], "amount": c["amount"], "cadence": c["cadence"]}
            for c in commitments["commitments"]
            if c["active"]
        ],
    }


async def _recent_stored(user_handle: str, max_age_hours: int) -> list[dict] | None:
    """The last generated set, if it is still fresh enough to reuse."""
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT e.summary, e.occurred_at
            FROM episodic_events AS e
            JOIN users AS u ON u.id = e.user_id
            WHERE u.handle = %s AND e.kind = 'insight'
              AND e.occurred_at > now() - %s
            ORDER BY e.occurred_at DESC
            LIMIT 6
            """,
            (user_handle, timedelta(hours=max_age_hours)),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    if not rows:
        return None
    newest = max(r["occurred_at"] for r in rows)
    return [
        {"text": r["summary"], "generated_at": r["occurred_at"].isoformat()}
        for r in rows
        if (newest - r["occurred_at"]).total_seconds() < 60
    ]


async def generate(user_handle: str, days: int = 30, refresh: bool = False) -> dict:
    if not refresh:
        cached = await _recent_stored(user_handle, max_age_hours=12)
        if cached:
            return {"insights": cached, "facts": None, "cached": True}

    facts = await _compute_facts(user_handle, days)
    if Decimal(facts["total_spend"]) == 0 and not facts["active_commitments"]:
        return {"insights": [], "facts": facts, "cached": False}

    response = await get_provider().chat(
        SYSTEM,
        [{"role": "user", "content": json.dumps(facts, default=str)}],
        tools=[],
    )
    raw = (response.text or "").strip()
    raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    try:
        items = json.loads(raw).get("insights", [])
    except (json.JSONDecodeError, AttributeError):
        log.warning("insights model returned unparseable output: %.150s", raw)
        return {"insights": [], "facts": facts, "cached": False}

    now = datetime.now(UTC).isoformat()
    insights = [
        {"kind": item.get("kind", "pattern"), "text": item["text"], "generated_at": now}
        for item in items
        if isinstance(item, dict) and item.get("text")
    ][:4]

    # Insights become memory: the agent can recall what it already told you.
    for item in insights:
        await episodic.record_event(user_handle, "insight", item["text"])

    return {"insights": insights, "facts": facts, "cached": False}
