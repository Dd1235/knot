"""Double-entry ledger service.

Account naming convention (type inferred from prefix):
    cash / bank / upi          -> asset
    expense:<category>         -> expense   (e.g. expense:food)
    income:<source>            -> income    (e.g. income:salary)
    receivable:<person>        -> receivable (auto-creates the person)
    liability:<name>           -> liability
    equity:opening             -> liability (opening-balance counterweight)

Sign convention: debits positive, credits negative; legs of a transaction sum
to exactly zero. A positive receivable balance means the person owes the user.
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Json

from app.db.pool import pool
from app.db.tx import run_serializable

TWO_PLACES = Decimal("0.01")


class LedgerError(Exception):
    pass


class UnbalancedTransaction(LedgerError):
    pass


class NothingOutstanding(LedgerError):
    pass


class OverSettlement(LedgerError):
    pass


@dataclass
class LegSpec:
    account: str
    amount: Decimal
    memo: str = ""


@dataclass
class PostedTransaction:
    id: UUID
    description: str
    category: str
    legs: list[dict]
    deduplicated: bool = False


# How a transaction is described to a human, derived from its legs rather than
# stored.
#
# Computed as one grouped pass over the legs, not as a CASE full of correlated
# EXISTS subqueries. The subquery version issued roughly eighteen of them per
# row — GROUP_CASE embedded DIRECTION_CASE, so every branch ran twice — and
# took 27 seconds to render 100 transactions. This reads identically and runs
# in milliseconds.
LEG_FLAGS = """
        SELECT l.transaction_id,
               COALESCE(SUM(l.amount) FILTER (WHERE l.amount > 0), 0) AS amount,
               bool_or(a.type = 'liability' AND a.name != 'equity:opening'
                       AND l.amount > 0) AS f_repaid,
               bool_or(a.type = 'liability' AND a.name != 'equity:opening'
                       AND l.amount < 0) AS f_borrowed,
               bool_or(a.type = 'receivable' AND l.amount > 0) AS f_lent,
               bool_or(a.type = 'receivable' AND l.amount < 0) AS f_settled,
               bool_or(a.name LIKE 'invest:%%' AND l.amount > 0) AS f_invested,
               bool_or(a.name LIKE 'invest:%%' AND l.amount < 0) AS f_sold,
               bool_or(a.type = 'expense' AND l.amount < 0) AS f_refund,
               bool_or(a.type = 'income') AS f_income,
               bool_and(a.type = 'asset') AS f_all_asset,
               string_agg(DISTINCT p.display_name, ', ') AS people
        FROM transaction_legs AS l
        JOIN accounts AS a ON a.id = l.account_id
        LEFT JOIN people AS p ON p.id = a.person_id
        GROUP BY l.transaction_id
"""

# Order matters: first match wins. Three of these branches exist because an
# earlier version fell through to 'spent' for anything it did not recognise,
# so "borrowed 5,000 from Priya" read as *spent* 5,000, a cash withdrawal read
# as spending, and so did every SIP.
def _flags_for(subquery: str) -> str:
    """LEG_FLAGS, bounded to a set of transaction ids so the leg scan is the
    size of the page rather than the size of the ledger."""
    return LEG_FLAGS.replace(
        "GROUP BY", f"WHERE l.transaction_id IN ({subquery})\n        GROUP BY"
    )


DIRECTION_CASE = """
                   CASE
                       WHEN t.metadata->>'voids' IS NOT NULL THEN 'reversal'
                       WHEN lf.f_repaid    THEN 'repaid'
                       WHEN lf.f_borrowed  THEN 'borrowed'
                       WHEN lf.f_lent      THEN 'lent'
                       WHEN lf.f_settled   THEN 'settled'
                       WHEN lf.f_invested  THEN 'invested'
                       -- Before f_income: a sale credits income:capital_gains,
                       -- so it would otherwise read as ordinary income.
                       WHEN lf.f_sold      THEN 'sold'
                       WHEN lf.f_refund    THEN 'refund'
                       WHEN lf.f_income    THEN 'received'
                       WHEN lf.f_all_asset THEN 'transfer'
                       ELSE 'spent'
                   END"""


# The spending group, resolved from the direction rather than from the category
# string alone.
#
# One flat category cannot serve both an inflow and an outflow: `rent` is mapped
# to essentials, so rent RECEIVED — a landlord's income — was rendering as an
# essential expense. The legs already know which way the money went.
GROUP_CASE = f"""
                   CASE {DIRECTION_CASE}
                       WHEN 'received' THEN 'income'
                       WHEN 'invested' THEN 'savings_invest'
                       WHEN 'sold' THEN 'savings_invest'
                       WHEN 'borrowed' THEN 'debt'
                       WHEN 'repaid' THEN 'debt'
                       WHEN 'transfer' THEN 'transfer'
                       WHEN 'settled' THEN 'transfer'
                       WHEN 'lent' THEN 'transfer'
                       ELSE COALESCE(cg.grp, 'other')
                   END"""


def _account_type(name: str) -> str:
    prefix = name.split(":", 1)[0]
    return {
        "expense": "expense",
        "income": "income",
        "receivable": "receivable",
        "liability": "liability",
        # equity:opening balances the opening-balance entry. It must NOT fall
        # through to 'asset' (that would double-count the opening amount);
        # it is stored as a liability and excluded by name from net worth.
        "equity": "liability",
    }.get(prefix, "asset")


# liability:priya is a person you owe. liability:loan:home is not, and neither
# is equity:opening — inventing a person called "Loan" would put it in the
# who-owes-who list.
NON_PERSON_LIABILITIES = {"loan", "card", "tax", "opening"}


def _is_person_account(name: str, acct_type: str) -> bool:
    if acct_type == "receivable":
        return True
    if acct_type != "liability":
        return False
    tail = name.split(":", 1)[1] if ":" in name else ""
    return bool(tail) and ":" not in tail and tail not in NON_PERSON_LIABILITIES


def _canonical_person(name: str) -> str:
    return name.strip().title()


async def ensure_user(conn: AsyncConnection, handle: str) -> UUID:
    cur = await conn.execute(
        """
        INSERT INTO users (handle) VALUES (%s)
        ON CONFLICT (handle) DO UPDATE SET handle = excluded.handle
        RETURNING id
        """,
        (handle,),
    )
    return (await cur.fetchone())[0]


async def _ensure_person(conn: AsyncConnection, user_id: UUID, name: str) -> UUID:
    cur = await conn.execute(
        """
        INSERT INTO people (user_id, display_name) VALUES (%s, %s)
        ON CONFLICT (user_id, display_name)
        DO UPDATE SET display_name = excluded.display_name
        RETURNING id
        """,
        (user_id, _canonical_person(name)),
    )
    return (await cur.fetchone())[0]


async def _ensure_account(conn: AsyncConnection, user_id: UUID, name: str) -> UUID:
    name = name.strip().lower()
    acct_type = _account_type(name)
    person_id = None
    if _is_person_account(name, acct_type):
        person_id = await _ensure_person(conn, user_id, name.split(":", 1)[1])
    cur = await conn.execute(
        """
        INSERT INTO accounts (user_id, name, type, person_id) VALUES (%s, %s, %s, %s)
        ON CONFLICT (user_id, name) DO UPDATE SET name = excluded.name
        RETURNING id
        """,
        (user_id, name, acct_type, person_id),
    )
    return (await cur.fetchone())[0]


def _validate_legs(legs: list[LegSpec]) -> list[LegSpec]:
    if len(legs) < 2:
        raise UnbalancedTransaction("a transaction needs at least 2 legs")
    normalized = [
        LegSpec(leg.account, Decimal(leg.amount).quantize(TWO_PLACES), leg.memo) for leg in legs
    ]
    if any(leg.amount == 0 for leg in normalized):
        raise UnbalancedTransaction("legs must have non-zero amounts")
    total = sum(leg.amount for leg in normalized)
    if total != 0:
        raise UnbalancedTransaction(f"legs sum to {total}, expected 0")
    return normalized


async def _post_in_conn(
    conn: AsyncConnection,
    user_id: UUID,
    description: str,
    legs: list[LegSpec],
    *,
    raw_input: str = "",
    source: str = "text",
    category: str = "uncategorized",
    occurred_at: datetime | None = None,
    idempotency_key: str | None = None,
) -> PostedTransaction:
    """Insert a balanced transaction. Must run inside a serializable txn."""
    legs = _validate_legs(legs)

    if idempotency_key:
        cur = await conn.execute(
            "SELECT transaction_id FROM idempotency_keys WHERE key = %s AND user_id = %s",
            (idempotency_key, user_id),
        )
        row = await cur.fetchone()
        if row:
            return await _load_transaction(conn, row[0], deduplicated=True)

    cur = await conn.execute(
        """
        INSERT INTO transactions
            (user_id, occurred_at, description, raw_input, source, category)
        VALUES (%s, COALESCE(%s, now()), %s, %s, %s, %s)
        RETURNING id
        """,
        (user_id, occurred_at, description, raw_input, source, category),
    )
    txn_id = (await cur.fetchone())[0]

    for leg in legs:
        account_id = await _ensure_account(conn, user_id, leg.account)
        await conn.execute(
            "INSERT INTO transaction_legs (transaction_id, account_id, amount, memo)"
            " VALUES (%s, %s, %s, %s)",
            (txn_id, account_id, leg.amount, leg.memo),
        )

    # Belt and braces: re-verify the zero-sum invariant against the actual
    # inserted rows before this serializable transaction is allowed to commit.
    cur = await conn.execute(
        "SELECT SUM(amount) FROM transaction_legs WHERE transaction_id = %s", (txn_id,)
    )
    if (await cur.fetchone())[0] != 0:
        raise UnbalancedTransaction("inserted legs do not sum to zero; rolling back")

    if idempotency_key:
        await conn.execute(
            "INSERT INTO idempotency_keys (key, user_id, transaction_id) VALUES (%s, %s, %s)",
            (idempotency_key, user_id, txn_id),
        )

    return await _load_transaction(conn, txn_id)


async def _load_transaction(
    conn: AsyncConnection, txn_id: UUID, deduplicated: bool = False
) -> PostedTransaction:
    cur = await conn.execute(
        "SELECT description, category FROM transactions WHERE id = %s", (txn_id,)
    )
    description, category = await cur.fetchone()
    cur = await conn.execute(
        """
        SELECT a.name AS account, l.amount::STRING AS amount, l.memo
        FROM transaction_legs AS l JOIN accounts AS a ON a.id = l.account_id
        WHERE l.transaction_id = %s
        ORDER BY a.name
        """,
        (txn_id,),
    )
    cur.row_factory = dict_row
    legs = await cur.fetchall()
    return PostedTransaction(txn_id, description, category, legs, deduplicated)


async def post_transaction(
    user_handle: str,
    description: str,
    legs: list[LegSpec],
    *,
    raw_input: str = "",
    source: str = "text",
    category: str = "uncategorized",
    occurred_at: datetime | None = None,
    idempotency_key: str | None = None,
) -> PostedTransaction:
    async def _fn(conn: AsyncConnection) -> PostedTransaction:
        user_id = await ensure_user(conn, user_handle)
        return await _post_in_conn(
            conn,
            user_id,
            description,
            legs,
            raw_input=raw_input,
            source=source,
            category=category,
            occurred_at=occurred_at,
            idempotency_key=idempotency_key,
        )

    return await run_serializable(_fn)


async def _settle_against(
    user_handle: str,
    account_name: str,
    *,
    sign: int,
    description: str,
    category: str,
    nothing_message: str,
    over_message: str,
    amount: Decimal | None = None,
    raw_input: str = "",
    source: str = "text",
    idempotency_key: str | None = None,
) -> PostedTransaction:
    """Pay down a derived balance, reading it inside the write.

    The read and the write share one serializable transaction. That is the whole
    write-skew defence: two concurrent "settle it all" commands both read the
    same outstanding balance, both try to zero it, and CockroachDB rejects one
    with a retry error rather than paying twice. /demo/race proves it.

    `sign` is +1 for a receivable (a positive balance means someone owes you)
    and -1 for a liability (a negative balance means you owe). Everything else
    is identical, which is why repayment reuses this instead of copying it.
    """

    async def _fn(conn: AsyncConnection) -> PostedTransaction:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            SELECT COALESCE(SUM(l.amount), 0)
            FROM transaction_legs AS l
            JOIN accounts AS a ON a.id = l.account_id
            WHERE a.user_id = %s AND a.name = %s
            """,
            (user_id, account_name),
        )
        outstanding = (await cur.fetchone())[0] * sign
        if outstanding <= 0:
            raise NothingOutstanding(nothing_message)
        settle_amount = outstanding if amount is None else Decimal(amount).quantize(TWO_PLACES)
        if settle_amount <= 0:
            raise LedgerError("amount must be positive")
        if settle_amount > outstanding:
            raise OverSettlement(over_message.format(amount=settle_amount, outstanding=outstanding))
        return await _post_in_conn(
            conn,
            user_id,
            description.format(amount=settle_amount),
            # Receivable (sign +1): money comes IN, the receivable shrinks.
            # Liability  (sign -1): money goes OUT, the liability shrinks.
            [
                LegSpec("cash", settle_amount * sign),
                LegSpec(account_name, -settle_amount * sign),
            ],
            raw_input=raw_input,
            source=source,
            category=category,
            idempotency_key=idempotency_key,
        )

    return await run_serializable(_fn)


async def settle_up(
    user_handle: str,
    person: str,
    amount: Decimal | None = None,
    *,
    raw_input: str = "",
    source: str = "text",
    idempotency_key: str | None = None,
) -> PostedTransaction:
    """Record that a person paid the user back."""
    who = _canonical_person(person)
    return await _settle_against(
        user_handle,
        f"receivable:{person.strip().lower()}",
        sign=1,
        description=f"{who} settled ₹{{amount}}",
        category="settlement",
        nothing_message=f"{who} owes nothing",
        over_message="settlement of {amount} exceeds outstanding {outstanding}",
        amount=amount,
        raw_input=raw_input,
        source=source,
        idempotency_key=idempotency_key,
    )


async def repay(
    user_handle: str,
    person: str,
    amount: Decimal | None = None,
    *,
    raw_input: str = "",
    source: str = "text",
    idempotency_key: str | None = None,
) -> PostedTransaction:
    """Record paying back money the user borrowed.

    There was no way to do this at all: `borrowed` created a liability account
    and nothing ever credited it, so a debt could be recorded and never cleared.
    """
    who = _canonical_person(person)
    return await _settle_against(
        user_handle,
        f"liability:{person.strip().lower()}",
        sign=-1,
        description=f"Repaid {who} ₹{{amount}}",
        category="repayment",
        nothing_message=f"you owe {who} nothing",
        over_message="repayment of {amount} exceeds outstanding {outstanding}",
        amount=amount,
        raw_input=raw_input,
        source=source,
        idempotency_key=idempotency_key,
    )


class OverSale(LedgerError):
    pass


async def sell_investment(
    user_handle: str,
    category: str,
    proceeds: Decimal,
    *,
    fraction: Decimal | None = None,
    description: str = "",
    raw_input: str = "",
    source: str = "text",
    idempotency_key: str | None = None,
) -> PostedTransaction:
    """Sell out of an investment, relieving cost and booking the gain.

    There was no way to do this, and the shape the agent reached for instead —
    cash in, income:stocks out — left the asset sitting on the books. Net worth
    rose by the whole sale amount, which is the same error as D23 inverted:
    money that changed shape being counted as money that appeared.

    Three legs, so nothing is double-counted:

        cash                 + proceeds
        invest:<category>    - cost relieved
        income:capital_gains - (proceeds - cost relieved)

    `fraction` is how much of the holding went, defaulting to all of it. Once
    per-instrument units land, cost relieved becomes quantity x average cost;
    the leg shape does not change.
    """
    from app.ledger import categories as _categories

    if not _categories.is_investment(category):
        raise LedgerError(f"{category} is not an investment category")
    proceeds = Decimal(proceeds).quantize(TWO_PLACES)
    if proceeds <= 0:
        raise LedgerError("proceeds must be positive")
    share = Decimal("1") if fraction is None else Decimal(fraction)
    if not 0 < share <= 1:
        raise LedgerError("fraction must be between 0 and 1")
    account_name = _categories.account_for(category)

    async def _fn(conn: AsyncConnection) -> PostedTransaction:
        user_id = await ensure_user(conn, user_handle)
        # Read the holding inside the write, the same guard settle_up and repay
        # use. Two concurrent "sell everything" commands cannot both relieve
        # the same cost.
        cur = await conn.execute(
            """
            SELECT COALESCE(SUM(l.amount), 0)
            FROM transaction_legs AS l
            JOIN accounts AS a ON a.id = l.account_id
            WHERE a.user_id = %s AND a.name = %s
            """,
            (user_id, account_name),
        )
        held = (await cur.fetchone())[0]
        if held <= 0:
            raise NothingOutstanding(f"nothing held in {category}")
        cost_relieved = (held * share).quantize(TWO_PLACES)
        if cost_relieved > held:
            raise OverSale(f"cannot sell {cost_relieved} of a {held} holding")
        gain = proceeds - cost_relieved

        legs = [LegSpec("cash", proceeds), LegSpec(account_name, -cost_relieved)]
        # A sale exactly at cost has no gain leg; a zero-amount leg is rejected
        # by the invariant check, and rightly so.
        if gain != 0:
            legs.append(LegSpec("income:capital_gains", -gain))
        return await _post_in_conn(
            conn,
            user_id,
            description or f"Sold {category}",
            legs,
            raw_input=raw_input,
            source=source,
            category=category,
            idempotency_key=idempotency_key,
        )

    return await run_serializable(_fn)


async def void_transaction(
    user_handle: str, transaction_id: str | UUID, reason: str = ""
) -> PostedTransaction:
    """Reverse a transaction with a negating entry. Nothing is ever deleted —
    the original and its reversal both stay on the books (audit trail)."""

    async def _fn(conn: AsyncConnection) -> PostedTransaction:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            SELECT description, category, occurred_at, metadata->>'voids'
            FROM transactions WHERE id = %s AND user_id = %s
            """,
            (transaction_id, user_id),
        )
        row = await cur.fetchone()
        if row is None:
            raise LedgerError("transaction not found")
        description, category, occurred_at, voids_ref = row
        if voids_ref is not None:
            raise LedgerError("cannot void a reversal entry")
        cur = await conn.execute(
            "SELECT 1 FROM transactions WHERE user_id = %s AND metadata->>'voids' = %s",
            (user_id, str(transaction_id)),
        )
        if await cur.fetchone():
            raise LedgerError("transaction is already voided")

        cur = await conn.execute(
            """
            INSERT INTO transactions
                (user_id, description, source, category, occurred_at, metadata)
            VALUES (%s, %s, 'system', %s, %s, %s)
            RETURNING id
            """,
            (
                user_id,
                f"Void: {description}" + (f" — {reason}" if reason else ""),
                # Same category and timestamp as the original: a reversal filed
                # under 'reversal' today would leave the original's category
                # uncancelled and put negative spend in the current window.
                category,
                occurred_at,
                Json({"voids": str(transaction_id)}),
            ),
        )
        reversal_id = (await cur.fetchone())[0]
        await conn.execute(
            """
            INSERT INTO transaction_legs (transaction_id, account_id, amount, memo)
            SELECT %s, account_id, -amount, 'reversal'
            FROM transaction_legs WHERE transaction_id = %s
            """,
            (reversal_id, transaction_id),
        )
        cur = await conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM transaction_legs WHERE transaction_id = %s",
            (reversal_id,),
        )
        if (await cur.fetchone())[0] != 0:
            raise UnbalancedTransaction("reversal legs do not sum to zero; rolling back")
        return await _load_transaction(conn, reversal_id)

    return await run_serializable(_fn)


async def account_balances(user_handle: str) -> list[dict]:
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT a.name, a.type::STRING, COALESCE(SUM(l.amount), 0)::STRING AS balance
            FROM accounts AS a
            LEFT JOIN transaction_legs AS l ON l.account_id = a.id
            JOIN users AS u ON u.id = a.user_id
            WHERE u.handle = %s
            GROUP BY a.name, a.type
            ORDER BY a.name
            """,
            (user_handle,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def person_balances(user_handle: str) -> list[dict]:
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT pb.display_name, pb.balance::STRING AS balance
            FROM person_balances AS pb
            JOIN users AS u ON u.id = pb.user_id
            WHERE u.handle = %s
            ORDER BY pb.display_name
            """,
            (user_handle,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def recent_transactions(user_handle: str, limit: int = 20) -> list[dict]:
    """Rows rich enough to render without a second query: what the user
    actually said, which spending group it belongs to, and which direction the
    money moved."""
    async with pool().connection() as conn:
        cur = await conn.execute(
            f"""
            WITH picked AS (
                SELECT t.id, t.user_id, t.occurred_at, t.description, t.category,
                       t.source, t.raw_input, t.metadata
                FROM transactions AS t
                JOIN users AS u ON u.id = t.user_id
                WHERE u.handle = %s
                ORDER BY t.occurred_at DESC
                LIMIT %s
            ),
            -- Flags for the picked rows only, so the leg scan is bounded by
            -- the page size rather than by the whole ledger.
            lf AS (
                {_flags_for("SELECT id FROM picked")}
            ),
            voided AS (
                SELECT DISTINCT v.metadata->>'voids' AS target
                FROM transactions AS v
                WHERE v.user_id IN (SELECT DISTINCT user_id FROM picked)
                  AND v.metadata->>'voids' IS NOT NULL
            )
            SELECT t.id::STRING, t.occurred_at, t.description, t.category,
                   t.source::STRING, t.raw_input,
                   t.metadata->>'annotation' AS annotation,
                   t.metadata->>'annotation_kind' AS annotation_kind,
                   {GROUP_CASE} AS grp,
                   lf.amount::STRING AS amount,
                   {DIRECTION_CASE} AS direction,
                   lf.people,
                   EXISTS(SELECT 1 FROM voided WHERE target = t.id::STRING) AS voided
            FROM picked AS t
            JOIN lf ON lf.transaction_id = t.id
            LEFT JOIN category_groups AS cg ON cg.category = t.category
            ORDER BY t.occurred_at DESC
            """,
            (user_handle, limit),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def ledger_sum(user_handle: str) -> Decimal:
    """Sum of every leg for the user — must always be exactly 0."""
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT COALESCE(SUM(l.amount), 0)
            FROM transaction_legs AS l
            JOIN transactions AS t ON t.id = l.transaction_id
            JOIN users AS u ON u.id = t.user_id
            WHERE u.handle = %s
            """,
            (user_handle,),
        )
        return (await cur.fetchone())[0]
