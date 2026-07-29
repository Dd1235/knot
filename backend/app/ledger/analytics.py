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


async def rhythm(user_handle: str, days: int = 30) -> dict:
    """How the user actually transacts, counted rather than summed.

    76% of UPI transactions are under ₹500 but carry ~7.5% of value, so a
    dashboard that ranks by rupees hides the chai, autos and food orders that
    ARE the user's daily life. Everything here is ordered by COUNT.
    """
    start, end, start_day = _window_bounds(days, 0)

    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT lower(t.description) AS merchant,
                   count(*) AS times,
                   SUM((SELECT COALESCE(SUM(l.amount) FILTER (WHERE l.amount > 0), 0)
                        FROM transaction_legs AS l
                        WHERE l.transaction_id = t.id))::STRING AS amount,
                   COALESCE(cg.grp, 'other') AS grp
            FROM transactions AS t
            JOIN users AS u ON u.id = t.user_id
            LEFT JOIN category_groups AS cg ON cg.category = t.category
            WHERE u.handle = %s AND t.occurred_at >= %s AND t.occurred_at < %s
              AND t.metadata->>'voids' IS NULL
              AND EXISTS (SELECT 1 FROM transaction_legs AS l
                          JOIN accounts AS a ON a.id = l.account_id
                          WHERE l.transaction_id = t.id AND a.type = 'expense')
            GROUP BY lower(t.description), cg.grp
            ORDER BY times DESC, amount DESC
            LIMIT 8
            """,
            (user_handle, start, end),
        )
        cur.row_factory = dict_row
        merchants = await cur.fetchall()

        # Day-of-week rhythm: the median is the honest "typical", since one
        # rent payment would drag a mean into uselessness.
        cur = await conn.execute(
            """
            SELECT extract(dow FROM day)::INT AS dow,
                   count(*) AS days_seen,
                   -- percentile_cont needs FLOAT in CockroachDB; quantized back below.
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY spend::FLOAT) AS typical
            FROM (
                SELECT ((t.occurred_at AT TIME ZONE 'Asia/Kolkata')::DATE) AS day,
                       COALESCE(SUM(l.amount) FILTER (WHERE a.type = 'expense'), 0) AS spend
                FROM transaction_legs AS l
                JOIN accounts AS a ON a.id = l.account_id
                JOIN transactions AS t ON t.id = l.transaction_id
                JOIN users AS u ON u.id = t.user_id
                WHERE u.handle = %s AND t.occurred_at >= %s AND t.occurred_at < %s
                GROUP BY day
            )
            GROUP BY dow
            ORDER BY dow
            """,
            (user_handle, start, end),
        )
        cur.row_factory = dict_row
        by_dow = await cur.fetchall()

        cur = await conn.execute(
            """
            SELECT count(*) AS txns,
                   count(DISTINCT (t.occurred_at AT TIME ZONE 'Asia/Kolkata')::DATE) AS active_days
            FROM transactions AS t
            JOIN users AS u ON u.id = t.user_id
            WHERE u.handle = %s AND t.occurred_at >= %s AND t.occurred_at < %s
              AND t.metadata->>'voids' IS NULL
            """,
            (user_handle, start, end),
        )
        txns, active_days = await cur.fetchone()

    return {
        "window_days": days,
        "transactions": txns,
        "active_days": active_days,
        "per_active_day": round(txns / active_days, 1) if active_days else 0.0,
        "no_spend_days": days - active_days,
        "top_merchants": [
            {
                "merchant": m["merchant"],
                "times": m["times"],
                "amount": _money(m["amount"]),
                "grp": m["grp"],
            }
            for m in merchants
        ],
        "by_weekday": [
            {"dow": r["dow"], "days_seen": r["days_seen"], "typical": _money(r["typical"])}
            for r in by_dow
        ],
    }


async def cash_float(user_handle: str) -> dict:
    """Physical cash withdrawn versus cash since accounted for.

    A withdrawal is specifically a transfer from another asset account into
    `cash` — money credited to cash from income is not cash-in-hand, and
    counting it would make the whole figure meaningless.

    Every SMS-parsing app is blind here by construction: the withdrawal is one
    line and the spending that follows is invisible. Voice is the only
    low-friction way to close the loop, which is why this is worth building.
    """
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            WITH withdrawals AS (
                SELECT t.id, t.occurred_at,
                       (SELECT l.amount FROM transaction_legs AS l
                        JOIN accounts AS a ON a.id = l.account_id
                        WHERE l.transaction_id = t.id AND a.name = 'cash') AS amount
                FROM transactions AS t
                JOIN users AS u ON u.id = t.user_id
                WHERE u.handle = %s
                  AND t.metadata->>'voids' IS NULL
                  -- credits cash...
                  AND EXISTS (SELECT 1 FROM transaction_legs AS l
                              JOIN accounts AS a ON a.id = l.account_id
                              WHERE l.transaction_id = t.id
                                AND a.name = 'cash' AND l.amount > 0)
                  -- ...and debits a DIFFERENT asset account: a real transfer
                  AND EXISTS (SELECT 1 FROM transaction_legs AS l
                              JOIN accounts AS a ON a.id = l.account_id
                              WHERE l.transaction_id = t.id
                                AND a.type = 'asset' AND a.name != 'cash' AND l.amount < 0)
            )
            SELECT COALESCE(SUM(amount), 0)::STRING AS withdrawn,
                   MAX(occurred_at) AS last_withdrawal,
                   (SELECT COALESCE(-SUM(l.amount), 0)
                    FROM transaction_legs AS l
                    JOIN accounts AS a ON a.id = l.account_id
                    JOIN transactions AS t ON t.id = l.transaction_id
                    JOIN users AS u ON u.id = t.user_id
                    WHERE u.handle = %s AND a.name = 'cash' AND l.amount < 0
                      AND t.metadata->>'voids' IS NULL
                      AND t.occurred_at >= (SELECT MIN(occurred_at) FROM withdrawals)
                   )::STRING AS spent_since
            FROM withdrawals
            """,
            (user_handle, user_handle),
        )
        withdrawn, last, spent_since = await cur.fetchone()

    withdrawn_d = Decimal(withdrawn)
    accounted = Decimal(spent_since or 0)
    unaccounted = max(withdrawn_d - accounted, Decimal("0"))
    return {
        "withdrawn": _money(withdrawn_d),
        "accounted": _money(accounted),
        "unaccounted": _money(unaccounted),
        "last_withdrawal": last.isoformat() if last else None,
    }


async def safe_to_spend(user_handle: str) -> dict:
    """Spendable money left once everything already claimed is set aside.

    The only forward-looking number on the dashboard — every other module is
    an autopsy. Deliberately derived rather than a budget the user sets:
    budgeting apps lose ~67% of users inside 30 days, and this asks nothing.
    """
    from app.ledger import recurring

    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT COALESCE(SUM(l.amount), 0)::STRING
            FROM transaction_legs AS l
            JOIN accounts AS a ON a.id = l.account_id
            JOIN users AS u ON u.id = a.user_id
            WHERE u.handle = %s AND a.type = 'asset'
            """,
            (user_handle,),
        )
        liquid = Decimal((await cur.fetchone())[0])

    ahead = await recurring.upcoming(user_handle)
    claimed = Decimal(ahead["claimed_before_income"])
    next_income = ahead["next_income"]
    available = liquid - claimed

    return {
        "liquid": _money(liquid),
        "claimed": _money(claimed),
        "available": _money(available),
        "next_income": next_income,
        "days_until_income": next_income["in_days"] if next_income else None,
        "per_day": (
            _money(available / next_income["in_days"])
            if next_income and next_income["in_days"] > 0 and available > 0
            else None
        ),
        "upcoming": ahead["outgoing"][:5],
    }
