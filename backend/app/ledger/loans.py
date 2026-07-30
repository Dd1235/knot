"""Loans and their EMIs.

An EMI booked as `expense:emi` is wrong in a way that compounds: only the
interest is spending, and the principal is a balance-sheet move that shrinks a
debt. Booking the whole payment as an expense overstates monthly spend by the
principal share — typically 60-80% of the payment — and hides the net-worth
improvement, every month.

Each payment therefore splits three ways:

    liability:loan:<key>  + principal      (the debt shrinks)
    expense:interest      + interest       (the only part that is spending)
    cash                  - (both)

There is no amortisation schedule table. `outstanding` is read back from the
ledger before each posting, so reducing-balance amortisation falls out as a
consequence of the entries rather than as a stored artifact that could
disagree with them.
"""

from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from app.db.pool import pool
from app.db.tx import run_serializable
from app.ledger.service import LedgerError, LegSpec, ensure_user

TWO_PLACES = Decimal("0.01")
MONTHS_IN_YEAR = Decimal("12")


def account_for(name: str) -> str:
    """`liability:loan:<key>` — the extra segment keeps it out of the
    who-owes-who list, which is for people rather than banks."""
    key = "".join(c if c.isalnum() else "_" for c in name.strip().lower()).strip("_")
    return f"liability:loan:{key or 'loan'}"


def monthly_rate(annual_rate: Decimal) -> Decimal:
    return Decimal(annual_rate) / MONTHS_IN_YEAR / Decimal("100")


def emi_for(principal: Decimal, annual_rate: Decimal, tenure_months: int) -> Decimal:
    """The standard reducing-balance EMI, used only as a default.

    If the user knows what the bank actually charges, that figure wins: banks
    round in their own way and a formula that disagrees by a rupee will drift
    over sixty payments.
    """
    r = monthly_rate(annual_rate)
    n = int(tenure_months)
    if n <= 0:
        raise LedgerError("tenure must be at least one month")
    if r == 0:
        return (Decimal(principal) / n).quantize(TWO_PLACES, ROUND_HALF_UP)
    factor = (1 + r) ** n
    return (Decimal(principal) * r * factor / (factor - 1)).quantize(TWO_PLACES, ROUND_HALF_UP)


def split_payment(
    outstanding: Decimal, emi: Decimal, annual_rate: Decimal
) -> tuple[Decimal, Decimal]:
    """(principal, interest) for one payment against this outstanding balance.

    The min() is what lands the final payment exactly on zero instead of
    overshooting into a negative balance.
    """
    interest = (outstanding * monthly_rate(annual_rate)).quantize(TWO_PLACES, ROUND_HALF_UP)
    payable = min(Decimal(emi), outstanding + interest)
    principal = (payable - interest).quantize(TWO_PLACES, ROUND_HALF_UP)
    return principal, interest


async def add_loan(
    user_handle: str,
    name: str,
    principal: Decimal,
    annual_rate: Decimal,
    tenure_months: int,
    *,
    emi: Decimal | None = None,
    lender: str = "",
    due_day: int = 5,
    already_running: bool = False,
) -> dict:
    """Register a loan and open its liability.

    `already_running` is for a loan that predates the app: the opening entry
    balances against equity:opening, which net worth already excludes by name,
    so liabilities rise by the outstanding amount without inventing income.
    """
    principal = Decimal(principal).quantize(TWO_PLACES)
    if principal <= 0:
        raise LedgerError("principal must be positive")
    if not 1 <= due_day <= 31:
        raise LedgerError("due_day must be between 1 and 31")
    payment = (
        Decimal(emi).quantize(TWO_PLACES)
        if emi
        else emi_for(principal, annual_rate, tenure_months)
    )
    account = account_for(name)

    async def _fn(conn: AsyncConnection) -> dict:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            INSERT INTO loans (user_id, name, lender, principal, annual_rate,
                               tenure_months, emi, due_day, account_name)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, name) DO UPDATE SET
                lender = excluded.lender, principal = excluded.principal,
                annual_rate = excluded.annual_rate, tenure_months = excluded.tenure_months,
                emi = excluded.emi, due_day = excluded.due_day, active = true
            RETURNING id::STRING, name, emi::STRING, account_name
            """,
            (user_id, name.strip(), lender.strip(), principal, Decimal(annual_rate),
             int(tenure_months), payment, due_day, account),
        )
        cur.row_factory = dict_row
        row = await cur.fetchone()

        from app.ledger import service

        existing = await conn.execute(
            "SELECT COALESCE(SUM(l.amount), 0) FROM transaction_legs AS l "
            "JOIN accounts AS a ON a.id = l.account_id "
            "WHERE a.user_id = %s AND a.name = %s",
            (user_id, account),
        )
        if (await existing.fetchone())[0] == 0:
            legs = (
                [LegSpec("equity:opening", principal), LegSpec(account, -principal)]
                if already_running
                else [LegSpec("cash", principal), LegSpec(account, -principal)]
            )
            await service._post_in_conn(
                conn,
                user_id,
                f"{name.strip()} opened",
                legs,
                source="system",
                category="loan",
            )
        return row

    return await run_serializable(_fn)


async def outstanding_for(user_handle: str, account_name: str) -> Decimal:
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT COALESCE(-SUM(l.amount), 0)
            FROM transaction_legs AS l
            JOIN accounts AS a ON a.id = l.account_id
            JOIN users AS u ON u.id = a.user_id
            WHERE u.handle = %s AND a.name = %s
            """,
            (user_handle, account_name),
        )
        return (await cur.fetchone())[0]


def months_remaining(outstanding: Decimal, emi: Decimal, annual_rate: Decimal) -> int | None:
    """Derived, not stored. None when the payment cannot outrun the interest."""
    r = monthly_rate(annual_rate)
    if outstanding <= 0:
        return 0
    if r == 0:
        return int((outstanding / emi).to_integral_value(ROUND_HALF_UP))
    if emi <= outstanding * r:
        return None
    import math

    n = -math.log(1 - float(outstanding * r / emi)) / math.log(1 + float(r))
    return max(1, math.ceil(n))


async def list_loans(user_handle: str) -> dict:
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT l.id::STRING, l.name, l.lender, l.principal::STRING,
                   l.annual_rate::STRING, l.tenure_months, l.emi::STRING,
                   l.due_day, l.account_name, l.active,
                   COALESCE(-(SELECT SUM(tl.amount) FROM transaction_legs AS tl
                              JOIN accounts AS a ON a.id = tl.account_id
                              WHERE a.user_id = l.user_id AND a.name = l.account_name), 0)::STRING
                       AS outstanding
            FROM loans AS l
            JOIN users AS u ON u.id = l.user_id
            WHERE u.handle = %s
            ORDER BY l.active DESC, l.name
            """,
            (user_handle,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()

    loans = []
    total_outstanding = Decimal("0")
    monthly = Decimal("0")
    for r in rows:
        out = Decimal(r["outstanding"])
        emi = Decimal(r["emi"])
        rate = Decimal(r["annual_rate"])
        left = months_remaining(out, emi, rate)
        principal, interest = (
            split_payment(out, emi, rate) if out > 0 else (Decimal("0"), Decimal("0"))
        )
        if r["active"]:
            total_outstanding += out
            monthly += emi
        loans.append(
            {
                **r,
                "outstanding": str(out),
                "months_remaining": left,
                "next_principal": str(principal),
                "next_interest": str(interest),
                # What the dashboard was hiding: most of an EMI is not spending.
                "principal_share": (
                    float(round(principal / (principal + interest) * 100, 1))
                    if principal + interest > 0
                    else 0.0
                ),
            }
        )
    return {
        "loans": loans,
        "total_outstanding": str(total_outstanding.quantize(TWO_PLACES)),
        "monthly_emi": str(monthly.quantize(TWO_PLACES)),
    }


async def post_due(user_handle: str, today: date | None = None) -> list[dict]:
    """Post every EMI whose period has arrived, idempotently.

    Shares `last_posted_period` with recurring commitments for the same reason:
    the period marker advances inside the transaction that writes the legs, so
    a double call cannot post twice.
    """
    from app.ledger import recurring, service

    today = today or date.today()
    posted: list[dict] = []

    async def _fn(conn: AsyncConnection) -> list[dict]:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            "SELECT id, name, annual_rate, emi, due_day, account_name, "
            "last_posted_period, created_at AS started_at "
            "FROM loans WHERE user_id = %s AND active = true",
            (user_id,),
        )
        cur.row_factory = dict_row
        for loan in await cur.fetchall():
            periods = recurring._periods_due(
                "monthly",
                loan["due_day"],
                # A loan's periods run from when it was opened, same as a
                # commitment's run from when it was created.
                loan["started_at"],
                today,
                loan["last_posted_period"],
            )
            for period in periods:
                bal = await conn.execute(
                    "SELECT COALESCE(-SUM(l.amount), 0) FROM transaction_legs AS l "
                    "JOIN accounts AS a ON a.id = l.account_id "
                    "WHERE a.user_id = %s AND a.name = %s",
                    (user_id, loan["account_name"]),
                )
                outstanding = (await bal.fetchone())[0]
                if outstanding <= 0:
                    break
                principal, interest = split_payment(outstanding, loan["emi"], loan["annual_rate"])
                legs = [LegSpec(loan["account_name"], principal)]
                if interest > 0:
                    legs.append(LegSpec("expense:interest", interest))
                legs.append(LegSpec("cash", -(principal + interest)))
                await service._post_in_conn(
                    conn,
                    user_id,
                    f"{loan['name']} EMI ({period})",
                    legs,
                    source="system",
                    category="emi",
                    occurred_at=recurring._period_start("monthly", period, loan["due_day"]),
                )
                posted.append(
                    {"loan": loan["name"], "period": period,
                     "principal": str(principal), "interest": str(interest)}
                )
            if periods:
                await conn.execute(
                    "UPDATE loans SET last_posted_period = %s WHERE id = %s",
                    (periods[-1], loan["id"]),
                )
        return posted

    return await run_serializable(_fn)
