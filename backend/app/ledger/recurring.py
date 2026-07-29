"""Recurring commitments: subscriptions, rent, salary — auto-posted per period.

A commitment posts at most once per period ('2026-07' for monthly, '2026' for
yearly). post_due() writes the ledger entry AND advances last_posted_period in
the same serializable transaction, so concurrent callers cannot double-post:
CockroachDB rejects the second writer, whose retry re-reads the advanced
period and skips.
"""

from calendar import monthrange
from datetime import date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from app.db.pool import pool
from app.db.tx import run_serializable
from app.ledger import service
from app.ledger.service import LedgerError, LegSpec, ensure_user

IST = ZoneInfo("Asia/Kolkata")
TWO_PLACES = Decimal("0.01")

CADENCES = {"monthly", "yearly"}
DIRECTIONS = {"spent", "received"}


class RecurringError(LedgerError):
    pass


async def upsert_commitment(
    user_handle: str,
    name: str,
    amount: Decimal,
    cadence: str = "monthly",
    due_day: int | None = None,
    category: str = "subscriptions",
    direction: str = "spent",
) -> dict:
    name = name.strip()
    amount = Decimal(amount).quantize(TWO_PLACES)
    category = (category or "subscriptions").strip().lower()
    if not name:
        raise RecurringError("a commitment needs a name")
    if amount <= 0:
        raise RecurringError("amount must be positive")
    if cadence not in CADENCES:
        raise RecurringError(f"cadence must be one of {sorted(CADENCES)}")
    if direction not in DIRECTIONS:
        raise RecurringError(f"direction must be one of {sorted(DIRECTIONS)}")
    if due_day is not None and not 1 <= due_day <= 31:
        raise RecurringError("due_day must be between 1 and 31")

    async def _fn(conn: AsyncConnection) -> dict:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            INSERT INTO recurring_commitments
                (user_id, name, amount, cadence, due_day, category, direction, active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, true)
            ON CONFLICT (user_id, name) DO UPDATE SET
                amount = excluded.amount, cadence = excluded.cadence,
                due_day = excluded.due_day, category = excluded.category,
                direction = excluded.direction, active = true
            RETURNING id::STRING, name, amount::STRING, cadence, due_day, category,
                      direction, active, last_posted_period
            """,
            (user_id, name, amount, cadence, due_day, category, direction),
        )
        cur.row_factory = dict_row
        return await cur.fetchone()

    return await run_serializable(_fn)


async def list_commitments(user_handle: str) -> dict:
    """All commitments (active first) plus the active monthly outflow total."""
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT c.id::STRING, c.name, c.amount::STRING, c.cadence, c.due_day,
                   c.category, c.direction, c.active, c.last_posted_period
            FROM recurring_commitments AS c
            JOIN users AS u ON u.id = c.user_id
            WHERE u.handle = %s
            ORDER BY c.active DESC, c.name
            """,
            (user_handle,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    monthly_total = sum(
        (
            Decimal(r["amount"]) / 12 if r["cadence"] == "yearly" else Decimal(r["amount"])
            for r in rows
            if r["active"] and r["direction"] == "spent"
        ),
        Decimal("0"),
    )
    return {
        "commitments": rows,
        "monthly_total": str(monthly_total.quantize(TWO_PLACES)),
    }


async def deactivate(user_handle: str, name: str) -> dict | None:
    async def _fn(conn: AsyncConnection) -> dict | None:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            UPDATE recurring_commitments SET active = false
            WHERE user_id = %s AND lower(name) = lower(%s)
            RETURNING id::STRING, name
            """,
            (user_id, name.strip()),
        )
        cur.row_factory = dict_row
        return await cur.fetchone()

    return await run_serializable(_fn)


def _periods_due(
    cadence: str,
    due_day: int | None,
    created_at: datetime,
    today: date,
    last_posted: str,
) -> list[str]:
    """Every period from the one after `last_posted` through today.

    Posting only the current period silently dropped months for anyone who
    didn't open the app — the tool promises the commitment posts each period.
    """
    current = _current_period(cadence, due_day, created_at, today)
    if current is None:
        return []
    if not last_posted:
        return [current]
    if last_posted >= current:
        return []

    periods: list[str] = []
    if cadence == "monthly":
        year, month = (int(p) for p in last_posted.split("-"))
        while True:
            month += 1
            if month > 12:
                month, year = 1, year + 1
            key = f"{year:04d}-{month:02d}"
            if key > current:
                break
            periods.append(key)
            if key == current:
                break
    else:
        for year in range(int(last_posted) + 1, int(current) + 1):
            periods.append(f"{year:04d}")
    # Cap the catch-up so a long-dormant account cannot post a hundred entries
    # in one request; the most recent periods are the ones that matter.
    return periods[-12:]


def _current_period(
    cadence: str, due_day: int | None, created_at: datetime, today: date
) -> str | None:
    """Period key the commitment is due for as of `today` (IST), else None."""
    if cadence == "monthly":
        # Clamp to the month's length: a "due on the 31st" commitment must still
        # post in 30-day months (and February) rather than silently skipping.
        last_day = monthrange(today.year, today.month)[1]
        if today.day >= min(due_day or 1, last_day):
            return f"{today.year:04d}-{today.month:02d}"
        return None
    # Yearly: due once the anniversary (month, day) of creation is reached.
    anniversary = created_at.astimezone(IST)
    if (today.month, today.day) >= (anniversary.month, anniversary.day):
        return f"{today.year:04d}"
    return None


def _period_start(cadence: str, period: str, due_day: int | None) -> datetime:
    """Date the entry belongs on, so back-filled periods land in their own
    analytics window rather than all piling onto today."""
    if cadence == "monthly":
        year, month = (int(p) for p in period.split("-"))
        day = min(due_day or 1, monthrange(year, month)[1])
    else:
        year, month, day = int(period), 1, 1
    return datetime(year, month, day, 12, 0, tzinfo=IST)


async def post_due(user_handle: str) -> list[str]:
    """Post every active commitment due for the current period; idempotent."""

    async def _fn(conn: AsyncConnection) -> list[str]:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            SELECT id, name, amount, cadence, due_day, category, direction,
                   last_posted_period, created_at
            FROM recurring_commitments
            WHERE user_id = %s AND active
            ORDER BY name
            """,
            (user_id,),
        )
        cur.row_factory = dict_row
        commitments = await cur.fetchall()

        today = datetime.now(IST).date()
        posted: list[str] = []
        for c in commitments:
            periods = _periods_due(
                c["cadence"], c["due_day"], c["created_at"], today, c["last_posted_period"]
            )
            if not periods:
                continue
            amount = c["amount"]
            if c["direction"] == "received":
                legs = [
                    LegSpec("cash", amount),
                    LegSpec(f"income:{c['category']}", -amount),
                ]
            else:
                legs = [
                    LegSpec(f"expense:{c['category']}", amount),
                    LegSpec("cash", -amount),
                ]
            for period in periods:
                await service._post_in_conn(
                    conn,
                    user_id,
                    f"{c['name']} (auto, {period})",
                    legs,
                    source="system",
                    category=c["category"],
                    occurred_at=_period_start(c["cadence"], period, c["due_day"]),
                )
            await conn.execute(
                "UPDATE recurring_commitments SET last_posted_period = %s WHERE id = %s",
                (periods[-1], c["id"]),
            )
            posted.append(c["name"])
        return posted

    return await run_serializable(_fn)


def _next_occurrence(cadence: str, due_day: int | None, today: date) -> date:
    """The next date this commitment falls due, on or after today."""
    if cadence == "yearly":
        return date(today.year + 1, 1, 1)
    day = due_day or 1
    this_month = min(day, monthrange(today.year, today.month)[1])
    if this_month >= today.day:
        return date(today.year, today.month, this_month)
    year, month = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
    return date(year, month, min(day, monthrange(year, month)[1]))


async def upcoming(user_handle: str, horizon_days: int = 45) -> dict:
    """Commitments falling due soon, and when money next arrives.

    `safe_to_spend` needs both halves: what is already claimed, and the date
    after which it stops mattering.
    """
    listed = await list_commitments(user_handle)
    today = datetime.now(IST).date()
    horizon = today + timedelta(days=horizon_days)

    outgoing, incoming = [], []
    for c in listed["commitments"]:
        if not c["active"]:
            continue
        due = _next_occurrence(c["cadence"], c["due_day"], today)
        if due > horizon:
            continue
        entry = {
            "name": c["name"],
            "amount": c["amount"],
            "category": c["category"],
            "due_on": due.isoformat(),
            "in_days": (due - today).days,
        }
        (incoming if c["direction"] == "received" else outgoing).append(entry)

    outgoing.sort(key=lambda e: e["due_on"])
    incoming.sort(key=lambda e: e["due_on"])
    next_income = incoming[0] if incoming else None
    # Only commitments landing BEFORE the next payday actually constrain today.
    claimed = sum(
        (
            Decimal(e["amount"])
            for e in outgoing
            if next_income is None or e["due_on"] <= next_income["due_on"]
        ),
        Decimal("0"),
    )
    return {
        "outgoing": outgoing,
        "incoming": incoming,
        "next_income": next_income,
        "claimed_before_income": str(claimed.quantize(TWO_PLACES)),
    }
