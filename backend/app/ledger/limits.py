"""Monthly limits, judged by pace rather than by total.

The distinction is the whole feature. "You've used 50% of your budget" is true
on the 5th and on the 25th and means something completely different each time.
What matters is whether you are ahead of the calendar:

    pace = (spent / limit) / (days_elapsed / days_in_month)

At 1.0 you land exactly on the limit. Above it you are early. That number is
also what makes a warning worth reading on the 5th, which is the only point at
which anyone can still act on it.

No AI anywhere in here. It is arithmetic over a SUM, which means it is
instant, free, and identical every time it runs.
"""

import difflib
from calendar import monthrange
from datetime import date, datetime, time
from decimal import Decimal
from zoneinfo import ZoneInfo

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from app.db.pool import pool
from app.db.tx import run_serializable
from app.ledger import categories
from app.ledger.service import LedgerError, ensure_user

IST = ZoneInfo("Asia/Kolkata")
TWO_PLACES = Decimal("0.01")

SCOPES = {"total", "group", "category"}

# Groups a spending limit can name. `savings_invest` is excluded because the
# spend query excludes it — investing is not spending, and a limit that could
# never be approached is a limit that lies. `income`, `transfer` and `other`
# are not things a user caps.
LIMITABLE_GROUPS = frozenset({"essentials", "discretionary", "debt"})


def _nearest_categories(target: str, limit: int = 3) -> list[str]:
    """Real categories a mistyped or invented target most likely meant.

    Substring match first — "book" should surface nothing but "grocery" should
    surface "groceries" — then difflib for genuine near-misses.
    """
    hits = [c for c in categories.ALL_CATEGORIES if target in c or c in target]
    if not hits:
        hits = difflib.get_close_matches(target, categories.ALL_CATEGORIES, n=limit, cutoff=0.7)
    return hits[:limit]


# Ahead of the calendar by this much before anything is said. Under it, being
# "over pace" is just what an uneven month looks like.
NUDGE_PACE = 1.15
# Far enough ahead that the month cannot recover without a change.
URGENT_PACE = 1.5
# Before this, a straight-line projection is arithmetic on noise: one heavy
# Saturday on the 1st "projects" to thirty-one heavy Saturdays. Rent lands on
# the 1st for most people, which makes day one the worst possible sample.
MIN_DAYS_TO_PROJECT = 4


def _month_bounds(today: date) -> tuple[datetime, datetime, int, int]:
    """(start, end, days elapsed inclusive, days in month) in IST."""
    days_in_month = monthrange(today.year, today.month)[1]
    start = datetime.combine(today.replace(day=1), time.min, tzinfo=IST)
    end = datetime.combine(
        date(today.year, today.month, days_in_month), time.max, tzinfo=IST
    )
    return start, end, today.day, days_in_month


async def set_limit(
    user_handle: str, amount: Decimal, scope: str = "total", target: str = ""
) -> dict:
    amount = Decimal(amount).quantize(TWO_PLACES)
    if amount <= 0:
        raise LedgerError("a limit must be positive")
    scope = (scope or "total").strip().lower()
    if scope not in SCOPES:
        raise LedgerError(f"scope must be one of {', '.join(sorted(SCOPES))}")
    target = "" if scope == "total" else (target or "").strip().lower()
    if scope != "total" and not target:
        raise LedgerError(f"a {scope} limit needs to say which {scope}")
    # An unvalidated target is worse than a rejected one. "limit books to 5000"
    # used to create a cap on a category no transaction can ever carry — books
    # get filed under education or shopping — so it sat at ₹0 spent forever and
    # looked like the ledger was failing to count. Name the real options instead.
    if scope == "category" and target not in categories.ALL_CATEGORIES:
        near = _nearest_categories(target)
        hint = f" Closest: {', '.join(near)}." if near else ""
        raise LedgerError(
            f"'{target}' is not a spending category, so a limit on it would never "
            f"match anything.{hint} Ask what categories exist, or cap a group "
            "instead — essentials, discretionary or debt."
        )
    if scope == "group" and target not in LIMITABLE_GROUPS:
        raise LedgerError(
            f"'{target}' is not a spending group — use one of "
            f"{', '.join(sorted(LIMITABLE_GROUPS))}. "
            f"If you meant a single category, say category instead."
        )

    async def _fn(conn: AsyncConnection) -> dict:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            INSERT INTO spend_limits (user_id, scope, target, amount)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (user_id, scope, target)
            DO UPDATE SET amount = excluded.amount, active = true
            RETURNING id::STRING, scope, target, amount::STRING
            """,
            (user_id, scope, target, amount),
        )
        cur.row_factory = dict_row
        return await cur.fetchone()

    return await run_serializable(_fn)


async def clear_limit(user_handle: str, scope: str = "total", target: str = "") -> dict | None:
    scope = (scope or "total").strip().lower()
    target = "" if scope == "total" else (target or "").strip().lower()

    async def _fn(conn: AsyncConnection) -> dict | None:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            UPDATE spend_limits SET active = false
            WHERE user_id = %s AND scope = %s AND target = %s AND active
            RETURNING scope, target, amount::STRING
            """,
            (user_id, scope, target),
        )
        cur.row_factory = dict_row
        return await cur.fetchone()

    return await run_serializable(_fn)


def _verdict(pace: float, spent: Decimal, limit: Decimal) -> str:
    if spent >= limit:
        return "over"
    if pace >= URGENT_PACE:
        return "urgent"
    if pace >= NUDGE_PACE:
        return "ahead"
    return "fine"


async def status(user_handle: str, today: date | None = None) -> dict:
    """Every active limit, with month-to-date spend and pace against it."""
    today = today or datetime.now(IST).date()
    start, end, day, days_in_month = _month_bounds(today)
    elapsed = day / days_in_month

    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT l.scope, l.target, l.amount::STRING
            FROM spend_limits AS l
            JOIN users AS u ON u.id = l.user_id
            WHERE u.handle = %s AND l.active
            ORDER BY l.scope, l.target
            """,
            (user_handle,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
        if not rows:
            return {"limits": [], "day": day, "days_in_month": days_in_month}

        # One pass over the month's expense legs. Investments are excluded the
        # same way they are everywhere else — putting money into a SIP is not
        # spending, and a limit that punished saving would be perverse.
        cur = await conn.execute(
            """
            SELECT t.category,
                   COALESCE(cg.grp, 'other') AS grp,
                   SUM(l.amount) AS amount
            FROM transaction_legs AS l
            JOIN accounts AS a ON a.id = l.account_id AND a.type = 'expense'
            JOIN transactions AS t ON t.id = l.transaction_id
            JOIN users AS u ON u.id = t.user_id
            LEFT JOIN category_groups AS cg ON cg.category = t.category
            WHERE u.handle = %s AND t.occurred_at >= %s AND t.occurred_at <= %s
              AND COALESCE(cg.grp, 'other') != 'savings_invest'
            GROUP BY t.category, cg.grp
            """,
            (user_handle, start, end),
        )
        cur.row_factory = dict_row
        spend_rows = await cur.fetchall()

    by_category: dict[str, Decimal] = {}
    by_group: dict[str, Decimal] = {}
    total = Decimal("0")
    for r in spend_rows:
        amount = Decimal(r["amount"])
        by_category[r["category"]] = by_category.get(r["category"], Decimal("0")) + amount
        by_group[r["grp"]] = by_group.get(r["grp"], Decimal("0")) + amount
        total += amount

    limits = []
    for row in rows:
        limit = Decimal(row["amount"])
        if row["scope"] == "total":
            spent = total
        elif row["scope"] == "group":
            spent = by_group.get(row["target"], Decimal("0"))
        else:
            spent = by_category.get(row["target"], Decimal("0"))

        share = float(spent / limit) if limit else 0.0
        pace = share / elapsed if elapsed else 0.0
        # Straight-line from today to month end at the current rate — but only
        # once there is enough of the month to extrapolate from.
        projected = (
            (spent / Decimal(day) * Decimal(days_in_month)).quantize(TWO_PLACES)
            if day >= MIN_DAYS_TO_PROJECT
            else None
        )
        limits.append(
            {
                "scope": row["scope"],
                "target": row["target"],
                "limit": str(limit),
                "spent": str(spent.quantize(TWO_PLACES)),
                "left": str((limit - spent).quantize(TWO_PLACES)),
                "share": round(share * 100, 1),
                "pace": round(pace, 2),
                "projected": str(projected) if projected is not None else None,
                "verdict": (
                    _verdict(pace, spent, limit)
                    if day >= MIN_DAYS_TO_PROJECT or spent >= limit
                    else "fine"
                ),
            }
        )

    return {
        "limits": limits,
        "day": day,
        "days_in_month": days_in_month,
        "days_left": days_in_month - day,
    }


async def suggestions(user_handle: str) -> list[dict]:
    """Limits worth offering, derived from what the user already spends.

    Asking someone to invent a number is the friction that kills budgeting
    apps. Their own median over the last three months is a figure they can
    accept or adjust in one breath.
    """
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT COALESCE(cg.grp, 'other') AS grp,
                   date_trunc('month', t.occurred_at) AS month,
                   SUM(l.amount) AS amount
            FROM transaction_legs AS l
            JOIN accounts AS a ON a.id = l.account_id AND a.type = 'expense'
            JOIN transactions AS t ON t.id = l.transaction_id
            JOIN users AS u ON u.id = t.user_id
            LEFT JOIN category_groups AS cg ON cg.category = t.category
            WHERE u.handle = %s
              AND t.occurred_at >= date_trunc('month', now()) - INTERVAL '3 months'
              AND t.occurred_at < date_trunc('month', now())
              AND COALESCE(cg.grp, 'other') NOT IN ('savings_invest', 'transfer')
            GROUP BY grp, month
            """,
            (user_handle,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()

    per_group: dict[str, list[Decimal]] = {}
    for r in rows:
        per_group.setdefault(r["grp"], []).append(Decimal(r["amount"]))

    out = []
    for grp, months in per_group.items():
        if len(months) < 2:
            continue  # one month is not a habit
        months.sort()
        median = months[len(months) // 2]
        if median < 500:
            continue
        # Rounded to a number a person would actually say out loud.
        step = Decimal("500") if median < 10000 else Decimal("1000")
        out.append(
            {
                "scope": "group",
                "target": grp,
                "suggested": str((median / step).quantize(Decimal("1")) * step),
                "median": str(median.quantize(TWO_PLACES)),
                "months_seen": len(months),
            }
        )
    return sorted(out, key=lambda s: Decimal(s["median"]), reverse=True)
