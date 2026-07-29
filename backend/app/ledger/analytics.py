"""Read-only spending analytics derived from the double-entry ledger.

Every aggregate here is a plain SUM over transaction legs. Voided transactions
are reversed by negating entries whose legs exactly cancel the original, so
plain sums already net them out — no special-casing of voided rows anywhere.

Sign conventions: debits positive / credits negative. Expense accounts
accumulate positive balances (spend = SUM); income accounts accumulate
negative balances (income shown to users = -SUM).
"""

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from psycopg.rows import dict_row

from app.db.pool import pool

IST = ZoneInfo("Asia/Kolkata")
TWO_PLACES = Decimal("0.01")
ONE_PLACE = Decimal("0.1")


def _money(value) -> str:
    return str(Decimal(value).quantize(TWO_PLACES))


def _window_bounds(days: int, offset_days: int = 0) -> tuple[datetime, datetime, date]:
    """Calendar-day window in IST: [start of the first day, start of the day
    after the last). `offset_days` shifts the whole window back, so the prior
    period of equal length is `offset_days=days`.

    Aligning the SQL filter to the same IST day boundaries the daily spine uses
    guarantees sum(daily) == the headline totals; a rolling now()-N*24h window
    would include hours that fall outside the first spine bucket.
    """
    last_day = datetime.now(IST).date() - timedelta(days=offset_days)
    start_day = last_day - timedelta(days=days - 1)
    start = datetime.combine(start_day, time.min, tzinfo=IST)
    end = datetime.combine(last_day + timedelta(days=1), time.min, tzinfo=IST)
    return start, end, start_day


async def summary(user_handle: str, days: int, offset_days: int = 0) -> dict:
    start, end, start_day = _window_bounds(days, offset_days)

    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT
                COALESCE(SUM(l.amount) FILTER (WHERE a.type = 'expense'), 0) AS spend,
                COALESCE(SUM(-l.amount) FILTER (WHERE a.type = 'income'), 0) AS income
            FROM transaction_legs AS l
            JOIN accounts AS a ON a.id = l.account_id
            JOIN transactions AS t ON t.id = l.transaction_id
            JOIN users AS u ON u.id = t.user_id
            WHERE u.handle = %s AND t.occurred_at >= %s AND t.occurred_at < %s
            """,
            (user_handle, start, end),
        )
        total_spend, total_income = await cur.fetchone()

        cur = await conn.execute(
            """
            SELECT t.category, COALESCE(cg.grp, 'other') AS grp, SUM(l.amount) AS amount
            FROM transaction_legs AS l
            JOIN accounts AS a ON a.id = l.account_id AND a.type = 'expense'
            JOIN transactions AS t ON t.id = l.transaction_id
            JOIN users AS u ON u.id = t.user_id
            LEFT JOIN category_groups AS cg ON cg.category = t.category
            WHERE u.handle = %s AND t.occurred_at >= %s AND t.occurred_at < %s
            GROUP BY t.category, cg.grp
            ORDER BY amount DESC, t.category
            """,
            (user_handle, start, end),
        )
        cur.row_factory = dict_row
        cat_rows = await cur.fetchall()

        cur = await conn.execute(
            """
            SELECT ((t.occurred_at AT TIME ZONE 'Asia/Kolkata')::DATE)::STRING AS day,
                   COALESCE(SUM(l.amount) FILTER (WHERE a.type = 'expense'), 0) AS spend,
                   COALESCE(SUM(-l.amount) FILTER (WHERE a.type = 'income'), 0) AS income
            FROM transaction_legs AS l
            JOIN accounts AS a ON a.id = l.account_id
            JOIN transactions AS t ON t.id = l.transaction_id
            JOIN users AS u ON u.id = t.user_id
            WHERE u.handle = %s AND t.occurred_at >= %s AND t.occurred_at < %s
            GROUP BY day
            """,
            (user_handle, start, end),
        )
        cur.row_factory = dict_row
        daily_rows = {row["day"]: row for row in await cur.fetchall()}

        # Net worth is all-time (balances, not a windowed flow).
        # equity:opening holds the balancing credit for opening-balance entries:
        # it is neither spendable money nor a real debt, so it is excluded from
        # both sides — otherwise every opening balance would show up as a fake
        # liability of the same size.
        cur = await conn.execute(
            """
            SELECT
                COALESCE(SUM(l.amount)
                         FILTER (WHERE a.type IN ('asset', 'receivable')), 0) AS assets,
                COALESCE(SUM(-l.amount)
                         FILTER (WHERE a.type = 'liability'
                                 AND a.name != 'equity:opening'), 0) AS liabilities
            FROM transaction_legs AS l
            JOIN accounts AS a ON a.id = l.account_id
            JOIN users AS u ON u.id = a.user_id
            WHERE u.handle = %s
            """,
            (user_handle,),
        )
        assets, liabilities = await cur.fetchone()

    by_category = [
        {"category": r["category"], "grp": r["grp"], "amount": _money(r["amount"])}
        for r in cat_rows
        if r["amount"] != 0
    ]

    group_totals: dict[str, Decimal] = {}
    for r in cat_rows:
        group_totals[r["grp"]] = group_totals.get(r["grp"], Decimal("0")) + r["amount"]
    group_totals = {grp: total for grp, total in group_totals.items() if total != 0}
    by_group = [
        {
            "grp": grp,
            "amount": _money(amount),
            "pct_of_spend": (
                float((amount / total_spend * 100).quantize(ONE_PLACE)) if total_spend else 0.0
            ),
        }
        for grp, amount in sorted(group_totals.items(), key=lambda kv: kv[1], reverse=True)
    ]

    daily = []
    for i in range(days):
        key = (start_day + timedelta(days=i)).isoformat()
        row = daily_rows.get(key)
        daily.append(
            {
                "date": key,
                "spend": _money(row["spend"]) if row else "0.00",
                "income": _money(row["income"]) if row else "0.00",
            }
        )

    return {
        "window_days": days,
        "total_spend": _money(total_spend),
        "total_income": _money(total_income),
        "net_cashflow": _money(total_income - total_spend),
        "net_worth": {
            "assets": _money(assets),
            "liabilities": _money(liabilities),
            "net_worth": _money(assets - liabilities),
        },
        "by_category": by_category,
        "by_group": by_group,
        "daily": daily,
    }


async def export_rows(user_handle: str, days: int) -> list[dict]:
    """One row per transaction in the window, oldest first, for CSV export."""
    start, end, _ = _window_bounds(days, 0)
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT ((t.occurred_at AT TIME ZONE 'Asia/Kolkata')::DATE)::STRING AS txn_date,
                   t.description,
                   t.category,
                   COALESCE(cg.grp, 'other') AS grp,
                   (SELECT COALESCE(SUM(l.amount) FILTER (WHERE l.amount > 0), 0)
                    FROM transaction_legs AS l
                    WHERE l.transaction_id = t.id)::STRING AS amount,
                   CASE
                       WHEN t.category = 'reversal' THEN 'reversal'
                       WHEN EXISTS (SELECT 1 FROM transaction_legs AS l
                                    JOIN accounts AS a ON a.id = l.account_id
                                    WHERE l.transaction_id = t.id AND a.type = 'income')
                           THEN 'received'
                       ELSE 'spent'
                   END AS direction,
                   t.source::STRING AS source,
                   EXISTS(SELECT 1 FROM transactions AS v
                          WHERE v.user_id = t.user_id
                            AND v.metadata->>'voids' = t.id::STRING) AS voided
            FROM transactions AS t
            JOIN users AS u ON u.id = t.user_id
            LEFT JOIN category_groups AS cg ON cg.category = t.category
            WHERE u.handle = %s AND t.occurred_at >= %s AND t.occurred_at < %s
            ORDER BY t.occurred_at, t.id
            """,
            (user_handle, start, end),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()
