"""Double-entry ledger service.

Account naming convention (type inferred from prefix):
    cash / bank / upi          -> asset
    expense:<category>         -> expense   (e.g. expense:food)
    income:<source>            -> income    (e.g. income:salary)
    receivable:<person>        -> receivable (auto-creates the person)
    liability:<name>           -> liability

Sign convention: debits positive, credits negative; legs of a transaction sum
to exactly zero. A positive receivable balance means the person owes the user.
"""

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from psycopg import AsyncConnection
from psycopg.rows import dict_row

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


def _account_type(name: str) -> str:
    prefix = name.split(":", 1)[0]
    return {
        "expense": "expense",
        "income": "income",
        "receivable": "receivable",
        "liability": "liability",
    }.get(prefix, "asset")


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
    if acct_type == "receivable":
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
            "SELECT transaction_id FROM idempotency_keys WHERE key = %s", (idempotency_key,)
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


async def settle_up(
    user_handle: str,
    person: str,
    amount: Decimal | None = None,
    *,
    raw_input: str = "",
    source: str = "text",
    idempotency_key: str | None = None,
) -> PostedTransaction:
    """Record that a person paid the user back.

    Reads the outstanding receivable and validates the settlement amount
    inside the same serializable transaction that writes the legs — this is
    what makes concurrent double-settlement impossible (write skew is
    rejected by CockroachDB and the retry re-reads a zero balance).
    """
    person_key = person.strip().lower()
    account_name = f"receivable:{person_key}"

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
        outstanding = (await cur.fetchone())[0]
        if outstanding <= 0:
            raise NothingOutstanding(f"{_canonical_person(person)} owes nothing")
        settle_amount = (
            outstanding if amount is None else Decimal(amount).quantize(TWO_PLACES)
        )
        if settle_amount > outstanding:
            raise OverSettlement(
                f"settlement of {settle_amount} exceeds outstanding {outstanding}"
            )
        return await _post_in_conn(
            conn,
            user_id,
            f"{_canonical_person(person)} settled ₹{settle_amount}",
            [
                LegSpec("cash", settle_amount),
                LegSpec(account_name, -settle_amount),
            ],
            raw_input=raw_input,
            source=source,
            category="settlement",
            idempotency_key=idempotency_key,
        )

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
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT t.id::STRING, t.occurred_at, t.description, t.category, t.source::STRING
            FROM transactions AS t
            JOIN users AS u ON u.id = t.user_id
            WHERE u.handle = %s
            ORDER BY t.occurred_at DESC
            LIMIT %s
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
