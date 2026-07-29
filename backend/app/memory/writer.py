"""The memory writer: a background pass over each committed transaction.

It does two jobs on one LLM call, so the second is effectively free:

  1. distils durable facts into semantic memory
  2. writes at most one short annotation onto the transaction itself

The annotation follows the same rule as the rest of the app — SQL computes
every number, the model only picks which already-true fact is worth saying and
phrases it. A model never asked to do arithmetic cannot get arithmetic wrong.
"""

import json
import logging
from decimal import Decimal

from psycopg.rows import dict_row
from psycopg.types.json import Json

from app.db.pool import pool
from app.llm.provider import get_provider
from app.memory import semantic

log = logging.getLogger(__name__)

VALID_KINDS = {"person", "merchant", "habit", "preference", "commitment"}
ANNOTATION_KINDS = {"recurrence", "price_change", "outlier", "frequency", "day_total"}

# Thresholds that decide whether ANYTHING is worth saying. Left to the model,
# it annotates ~93% of rows with things like "1 time this month" — true, and
# useless. The bar lives here so it is deterministic and tunable.
HABIT_REPEATS = 3          # a merchant is a habit only after this many in a month
OUTLIER_RATIO = 2.0        # this much above the category median is remarkable
CHEAP_RATIO = 0.4          # ...or this much below
# A median over two chais is not a baseline. Without this, a ₹180 coffee gets
# compared to a ₹17.50 "typical food spend" and the note reads as nonsense.
MIN_SAMPLES_FOR_MEDIAN = 5
BUSY_DAY_TXNS = 8          # a running total is only interesting on a busy day

SYSTEM = """You distill durable facts about a user's financial life, and
optionally write ONE short note about the transaction just recorded.

Return STRICT JSON only (no prose, no code fences):
{"facts": [{"kind": "person|merchant|habit|preference|commitment",
            "subject": "<short name>", "fact": "<one sentence>"}],
 "annotation": {"kind": "recurrence|price_change|outlier|frequency|rank|day_total|streak",
                "text": "<max 8 words>"} | null}

FACTS: only things worth remembering for months — people and the user's
financial relationship with them, recurring merchants, habits, commitments.
A one-off purchase is NOT a fact. An empty list is a good answer.

ANNOTATION: you are given ALREADY-COMPUTED context. Use its numbers verbatim;
never calculate anything yourself. Pick at most ONE note, in this order of
value: a recurring charge worth tracking > a price change > an unusually large
amount > how often this merchant recurs > a rank > today's running total >
a broken no-spend streak.

`annotation_kinds_allowed` lists the ONLY kinds the facts support. If it is
empty, the annotation MUST be null — the transaction is unremarkable, which is
the normal case. Never annotate a first visit, a single occurrence, or a
running total unless that kind is listed.

NEVER: judge or moralise ("that's a lot for coffee"), restate the row
("₹120 at Swiggy"), praise ("great job!"), or state a number not given to you."""


async def _context_packet(user_handle: str, transaction_id, description: str) -> dict:
    """Everything the model is allowed to mention, computed in one query."""
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            WITH me AS (
                SELECT t.id, t.category, t.occurred_at, u.id AS user_id,
                       (SELECT COALESCE(SUM(l.amount) FILTER (WHERE l.amount > 0), 0)
                        FROM transaction_legs AS l WHERE l.transaction_id = t.id) AS amount
                FROM transactions AS t
                JOIN users AS u ON u.id = t.user_id
                WHERE t.id = %s AND u.handle = %s
            )
            SELECT
                (SELECT amount FROM me)::STRING AS amount,
                (SELECT category FROM me) AS category,
                (SELECT count(*) FROM transactions AS t, me
                 WHERE t.user_id = me.user_id AND lower(t.description) = lower(%s)
                   AND t.occurred_at >= date_trunc('month', me.occurred_at)) AS merchant_this_month,
                (SELECT count(*) FROM transactions AS t, me
                 WHERE t.user_id = me.user_id AND lower(t.description) = lower(%s)
                   AND t.occurred_at >= me.occurred_at - INTERVAL '7 days') AS merchant_this_week,
                (SELECT min(t.occurred_at) FROM transactions AS t, me
                 WHERE t.user_id = me.user_id
                   AND lower(t.description) = lower(%s)) AS merchant_first_seen,
                (SELECT percentile_cont(0.5) WITHIN GROUP (
                    ORDER BY (SELECT COALESCE(SUM(l.amount) FILTER (WHERE l.amount > 0), 0)
                              FROM transaction_legs AS l
                              WHERE l.transaction_id = t.id)::FLOAT)
                 FROM transactions AS t, me
                 WHERE t.user_id = me.user_id AND t.category = me.category
                   AND t.id != me.id
                   AND t.occurred_at >= me.occurred_at - INTERVAL '90 days') AS category_median,
                (SELECT count(*) FROM transactions AS t, me
                 WHERE t.user_id = me.user_id AND t.category = me.category
                   AND t.id != me.id
                   AND t.occurred_at >= me.occurred_at - INTERVAL '90 days') AS category_sample,
                (SELECT count(*) FROM transactions AS t, me
                 WHERE t.user_id = me.user_id
                   AND (t.occurred_at AT TIME ZONE 'Asia/Kolkata')::DATE
                       = (me.occurred_at AT TIME ZONE 'Asia/Kolkata')::DATE) AS txns_today,
                (SELECT COALESCE(SUM(l.amount), 0)
                 FROM transaction_legs AS l
                 JOIN accounts AS a ON a.id = l.account_id AND a.type = 'expense'
                 JOIN transactions AS t ON t.id = l.transaction_id, me
                 WHERE t.user_id = me.user_id
                   AND (t.occurred_at AT TIME ZONE 'Asia/Kolkata')::DATE
                       = (me.occurred_at AT TIME ZONE 'Asia/Kolkata')::DATE)::STRING AS spend_today,
                (SELECT count(*) FROM transactions AS t, me
                 WHERE t.user_id = me.user_id AND t.id != me.id
                   AND lower(t.description) = lower(%s)
                   AND t.metadata->>'annotation' IS NOT NULL
                   AND t.occurred_at >= me.occurred_at - INTERVAL '7 days'
                ) AS merchant_annotated_recently,
                (SELECT count(*) FROM transactions AS t, me
                 WHERE t.user_id = me.user_id AND t.id != me.id
                   AND t.metadata->>'annotation_kind' = 'day_total'
                   AND (t.occurred_at AT TIME ZONE 'Asia/Kolkata')::DATE
                       = (me.occurred_at AT TIME ZONE 'Asia/Kolkata')::DATE
                ) AS day_total_already
            """,
            (transaction_id, user_handle, description, description, description, description),
        )
        cur.row_factory = dict_row
        row = await cur.fetchone()

    if row is None:
        return {}

    amount = Decimal(row["amount"] or 0)
    median = Decimal(str(row["category_median"])) if row["category_median"] else None
    packet = {
        "merchant": description,
        "amount": str(amount),
        "category": row["category"],
        "times_this_month": row["merchant_this_month"],
        "times_this_week": row["merchant_this_week"],
        "first_time_here": row["merchant_this_month"] <= 1
        and row["merchant_first_seen"] is not None,
        "transactions_today": row["txns_today"],
        "spend_today": row["spend_today"],
        "_merchant_annotated_recently": row["merchant_annotated_recently"] > 0,
        "_day_total_already": row["day_total_already"] > 0,
    }
    if median and median > 0 and row["category_sample"] >= MIN_SAMPLES_FOR_MEDIAN:
        packet["category_typical"] = str(median.quantize(Decimal("0.01")))
        packet["times_typical"] = float(round(amount / median, 1))
    return packet


def _worth_saying(packet: dict) -> list[str]:
    """Which annotation kinds the facts actually support. Empty means the
    transaction is unremarkable — the common case, and the right answer."""
    if not packet:
        return []
    allowed: list[str] = []
    # One note per merchant per week: otherwise a daily habit annotates every
    # single row and the column becomes wallpaper.
    if packet.get("_merchant_annotated_recently"):
        return []
    if packet.get("times_this_month", 0) >= HABIT_REPEATS:
        allowed.append("frequency")
        allowed.append("recurrence")
    ratio = packet.get("times_typical")
    if ratio is not None and (ratio >= OUTLIER_RATIO or ratio <= CHEAP_RATIO):
        allowed.append("outlier")
        allowed.append("price_change")
    if (
        packet.get("transactions_today", 0) >= BUSY_DAY_TXNS
        and not packet.get("_day_total_already")
    ):
        allowed.append("day_total")
    return sorted(set(allowed))


async def _store_annotation(transaction_id, kind: str, text: str) -> None:
    """transactions.metadata is otherwise unused (only void writes to it), so
    the annotation rides along with no schema change."""
    async with pool().connection() as conn:
        await conn.execute(
            "UPDATE transactions SET metadata = metadata || %s WHERE id = %s",
            (Json({"annotation": text, "annotation_kind": kind}), transaction_id),
        )


async def process_event(
    user_handle: str, event_text: str, transaction_id=None, description: str = ""
) -> None:
    context = (
        await _context_packet(user_handle, transaction_id, description)
        if transaction_id and description
        else {}
    )
    allowed = _worth_saying(context)
    payload = {
        "event": event_text,
        "context": context or None,
        # An empty list means: this transaction is unremarkable, say nothing.
        "annotation_kinds_allowed": allowed,
    }

    response = await get_provider().chat(
        SYSTEM, [{"role": "user", "content": json.dumps(payload, default=str)}], tools=[]
    )
    raw = (response.text or "").strip()
    raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```")
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, AttributeError):
        log.warning("memory writer returned unparseable output: %.120s", raw)
        return

    for fact in parsed.get("facts", []):
        if fact.get("kind") in VALID_KINDS and fact.get("fact"):
            await semantic.remember(
                user_handle, fact["kind"], fact.get("subject", ""), fact["fact"]
            )

    annotation = parsed.get("annotation")
    # Enforce the bar in code: the model may only use a kind the facts support.
    if (
        transaction_id
        and allowed
        and isinstance(annotation, dict)
        and annotation.get("text")
        and annotation.get("kind") in allowed
    ):
        await _store_annotation(transaction_id, annotation["kind"], annotation["text"].strip())
