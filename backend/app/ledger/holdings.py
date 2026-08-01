"""Per-instrument investments: units, cost basis, and what they're worth now.

The rule that shapes everything here: **quantity is an annotation on the money
leg, never a second source of truth.** `amount = round(qty x price, 2)`, so
`qty x price` will sometimes miss `amount` by a paisa. If quantity were an
invariant that residue would break the ledger. It is not, so no rounding ever
can — and units are derived exactly the way balances are, with a SUM.

Cost is weighted-average rather than FIFO lots. FIFO needs a mutable
`remaining_qty` per lot, which is the stored-mutable-state this codebase avoids
everywhere else, plus row locking on every sale. Weighted average is computable
from history alone, and after a sale it is mathematically *unchanged* — which
is precisely why no lots table is needed.
"""

from decimal import ROUND_HALF_UP, Decimal

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from app.db.pool import pool
from app.db.tx import run_serializable
from app.ledger import categories
from app.ledger.service import LedgerError, LegSpec, ensure_user

TWO_PLACES = Decimal("0.01")
EIGHT_PLACES = Decimal("0.00000001")

KINDS = {"stocks", "mutual_funds", "gold", "crypto", "bonds", "elss", "etf"}


class OverSale(LedgerError):
    pass


def _plain(d: Decimal) -> str:
    """Decimal.normalize() turns 10 into '1E+1', which then went straight into
    a transaction description the user reads."""
    d = d.normalize()
    return f"{d:f}"


def symbol_of(name: str) -> str:
    """'Reliance Industries' -> 'reliance_industries'. Stable, and legible in
    an account name."""
    cleaned = "".join(c if c.isalnum() else "_" for c in name.strip().lower())
    return cleaned.strip("_") or "unknown"


def account_for(kind: str, symbol: str) -> str:
    """`invest:stocks:reliance`.

    Still prefixed `invest`, so `_account_type` returns 'asset' with no change
    and every existing `LIKE 'invest:%'` filter in analytics keeps matching.
    That backward compatibility is the reason the symbol lives in the account
    name and not only in a foreign key.
    """
    kind = kind if kind in KINDS else "stocks"
    return f"{categories.INVEST_PREFIX}{kind}:{symbol_of(symbol)}"


async def _ensure_instrument(
    conn: AsyncConnection, user_id, symbol: str, kind: str, display_name: str = ""
):
    cur = await conn.execute(
        """
        INSERT INTO instruments (user_id, symbol, kind, display_name)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (user_id, symbol) DO UPDATE SET
            kind = excluded.kind,
            display_name = CASE
                WHEN excluded.display_name != '' THEN excluded.display_name
                ELSE instruments.display_name
            END
        RETURNING id
        """,
        # Passed through empty on purpose. Defaulting it to the symbol made
        # every later buy look like a rename, so a second purchase of Reliance
        # replaced "Reliance Industries" with "reliance".
        (user_id, symbol_of(symbol), kind if kind in KINDS else "stocks",
         display_name.strip()),
    )
    return (await cur.fetchone())[0]


async def _link_account(conn: AsyncConnection, account_id, instrument_id) -> None:
    await conn.execute(
        "UPDATE accounts SET instrument_id = %s WHERE id = %s AND instrument_id IS NULL",
        (instrument_id, account_id),
    )


async def _annotate_leg(
    conn: AsyncConnection, txn_id, account_id, quantity: Decimal, price: Decimal, instrument_id
) -> None:
    await conn.execute(
        """
        UPDATE transaction_legs
        SET quantity = %s, unit_price = %s, instrument_id = %s
        WHERE transaction_id = %s AND account_id = %s
        """,
        (quantity, price, instrument_id, txn_id, account_id),
    )


async def buy(
    user_handle: str,
    symbol: str,
    quantity: Decimal | None = None,
    unit_price: Decimal | None = None,
    *,
    amount: Decimal | None = None,
    kind: str = "stocks",
    account: str = "bank",
    display_name: str = "",
    raw_input: str = "",
    source: str = "text",
) -> dict:
    """Buy into a named instrument. Money changes shape; net worth does not move.

    Units are optional. "Bought Pidilite for 1700" is how people usually say
    it, and requiring a quantity meant those went to a category bucket instead
    — invisible on the portfolio page and lumped into one anonymous total. An
    instrument held by amount alone still has a name, a cost basis and a row;
    it just cannot be valued per unit until units are known.
    """
    from app.ledger import service

    if quantity is not None and unit_price is not None:
        quantity = Decimal(quantity).quantize(EIGHT_PLACES)
        unit_price = Decimal(unit_price).quantize(Decimal("0.0001"))
        if quantity <= 0 or unit_price <= 0:
            raise LedgerError("quantity and price must be positive")
        cost = (quantity * unit_price).quantize(TWO_PLACES, ROUND_HALF_UP)
    elif amount is not None:
        quantity = unit_price = None
        cost = Decimal(amount).quantize(TWO_PLACES)
        if cost <= 0:
            raise LedgerError("amount must be positive")
    else:
        raise LedgerError("give either quantity and price, or an amount")
    holding = account_for(kind, symbol)

    async def _fn(conn: AsyncConnection) -> dict:
        user_id = await ensure_user(conn, user_handle)
        instrument_id = await _ensure_instrument(conn, user_id, symbol, kind, display_name)
        posted = await service._post_in_conn(
            conn,
            user_id,
            f"Bought {_plain(quantity)} {symbol.strip()}"
            if quantity is not None
            else f"Bought {symbol.strip()}",
            [LegSpec(holding, cost), LegSpec(account, -cost)],
            raw_input=raw_input,
            source=source,
            category=kind,
        )
        account_id = await service._ensure_account(conn, user_id, holding)
        await _link_account(conn, account_id, instrument_id)
        await _annotate_leg(conn, posted.id, account_id, quantity, unit_price, instrument_id)
        return {
            "transaction_id": str(posted.id),
            "symbol": symbol_of(symbol),
            "units": _plain(quantity) if quantity is not None else None,
            "cost": str(cost),
        }

    return await run_serializable(_fn)


async def sell(
    user_handle: str,
    symbol: str,
    quantity: Decimal,
    unit_price: Decimal,
    *,
    kind: str = "stocks",
    account: str = "bank",
    raw_input: str = "",
    source: str = "text",
) -> dict:
    """Sell units, relieving cost at the weighted average and booking the gain.

    Units held and average cost are read INSIDE the write, the same guard
    settle, repay and the category-level sell all use. Two concurrent "sell
    everything" commands cannot both relieve the same cost.
    """
    from app.ledger import service

    quantity = Decimal(quantity).quantize(EIGHT_PLACES)
    unit_price = Decimal(unit_price).quantize(Decimal("0.0001"))
    if quantity <= 0 or unit_price <= 0:
        raise LedgerError("quantity and price must be positive")
    holding = account_for(kind, symbol)
    proceeds = (quantity * unit_price).quantize(TWO_PLACES, ROUND_HALF_UP)

    async def _fn(conn: AsyncConnection) -> dict:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            SELECT COALESCE(SUM(l.quantity), 0), COALESCE(SUM(l.amount), 0)
            FROM transaction_legs AS l
            JOIN accounts AS a ON a.id = l.account_id
            WHERE a.user_id = %s AND a.name = %s
            """,
            (user_id, holding),
        )
        units_held, cost_held = await cur.fetchone()
        if units_held <= 0:
            raise LedgerError(f"you hold no {symbol}")
        if quantity > units_held:
            raise OverSale(f"cannot sell {_plain(quantity)} of {_plain(units_held)} held")

        avg_cost = cost_held / units_held
        cost_relieved = (quantity * avg_cost).quantize(TWO_PLACES, ROUND_HALF_UP)
        gain = proceeds - cost_relieved

        legs = [LegSpec(account, proceeds), LegSpec(holding, -cost_relieved)]
        # A sale exactly at cost has no gain leg — a zero-amount leg is rejected
        # by the invariant check, and rightly so.
        if gain != 0:
            legs.append(LegSpec("income:capital_gains", -gain))
        posted = await service._post_in_conn(
            conn,
            user_id,
            f"Sold {_plain(quantity)} {symbol.strip()}",
            legs,
            raw_input=raw_input,
            source=source,
            category=kind,
        )
        account_id = await service._ensure_account(conn, user_id, holding)
        cur = await conn.execute(
            "SELECT id FROM instruments WHERE user_id = %s AND symbol = %s",
            (user_id, symbol_of(symbol)),
        )
        row = await cur.fetchone()
        await _annotate_leg(
            conn, posted.id, account_id, -quantity, unit_price, row[0] if row else None
        )
        return {
            "transaction_id": str(posted.id),
            "units_sold": _plain(quantity),
            "proceeds": str(proceeds),
            "cost_relieved": str(cost_relieved),
            "realised_gain": str(gain),
        }

    return await run_serializable(_fn)


async def mark_price(user_handle: str, symbol: str, price: Decimal) -> dict:
    """Record what an instrument is worth now, as stated by the user.

    Never becomes legs. An unrealised gain is not a transaction, and inventing
    entries for it would put the ledger's zero-sum at the mercy of a number
    somebody said out loud.
    """
    price = Decimal(price).quantize(Decimal("0.0001"))
    if price <= 0:
        raise LedgerError("price must be positive")

    async def _fn(conn: AsyncConnection) -> dict:
        user_id = await ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            UPDATE instruments SET last_price = %s, last_price_at = now()
            WHERE user_id = %s AND symbol = %s
            RETURNING symbol, display_name
            """,
            (price, user_id, symbol_of(symbol)),
        )
        row = await cur.fetchone()
        if row is None:
            raise LedgerError(f"you don't hold {symbol}")
        return {"symbol": row[0], "price": str(price)}

    return await run_serializable(_fn)


async def portfolio(user_handle: str) -> dict:
    """Holdings, with cost and market value side by side. The delta is the
    only number here that isn't already on another screen."""
    async with pool().connection() as conn:
        cur = await conn.execute(
            """
            SELECT h.symbol, h.display_name, h.kind,
                   h.units::STRING, h.cost_basis::STRING, h.avg_cost::STRING,
                   h.last_price::STRING, h.last_price_at,
                   h.market_value::STRING, h.unrealised::STRING
            FROM holdings AS h
            JOIN users AS u ON u.id = h.user_id
            WHERE u.handle = %s
            ORDER BY h.cost_basis DESC
            """,
            (user_handle,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()

        # Money in invest: accounts that predates per-instrument tracking, or
        # was bought by category. Real money, so it must be shown; it just has
        # no units behind it and cannot appear in the holdings table.
        cur = await conn.execute(
            """
            SELECT COALESCE(SUM(l.amount), 0)::STRING
            FROM transaction_legs AS l
            JOIN accounts AS a ON a.id = l.account_id
            JOIN users AS u ON u.id = a.user_id
            WHERE u.handle = %s AND a.name LIKE 'invest:%%' AND a.instrument_id IS NULL
            """,
            (user_handle,),
        )
        unitemised = Decimal((await cur.fetchone())[0])

        cur = await conn.execute(
            """
            SELECT COALESCE(-SUM(l.amount), 0)::STRING
            FROM transaction_legs AS l
            JOIN accounts AS a ON a.id = l.account_id
            JOIN users AS u ON u.id = a.user_id
            WHERE u.handle = %s AND a.name = 'income:capital_gains'
            """,
            (user_handle,),
        )
        realised = Decimal((await cur.fetchone())[0])

    # The Decimal("0") start is load-bearing: sum() over an empty sequence
    # returns int 0, and the .quantize() below then raises AttributeError. That
    # made this endpoint 500 for every user who held nothing — which is every
    # new account — and took the list_holdings tool down mid-conversation.
    cost = sum((Decimal(r["cost_basis"]) for r in rows), Decimal("0"))
    valued = [r for r in rows if r["market_value"] is not None]
    market = sum((Decimal(r["market_value"]) for r in valued), Decimal("0"))
    # Only holdings with a stated price can be marked to market; the rest are
    # carried at cost so the total never silently understates the portfolio.
    at_market = market + sum(
        (Decimal(r["cost_basis"]) for r in rows if r["market_value"] is None), Decimal("0")
    )

    return {
        "holdings": [
            {
                **r,
                "last_price_at": r["last_price_at"].isoformat() if r["last_price_at"] else None,
                "priced": r["market_value"] is not None,
            }
            for r in rows
        ],
        "cost_basis": str(cost.quantize(TWO_PLACES)),
        "market_value": str(at_market.quantize(TWO_PLACES)),
        "unrealised": str((at_market - cost).quantize(TWO_PLACES)),
        "realised_gain": str(realised.quantize(TWO_PLACES)),
        "unitemised": str(unitemised.quantize(TWO_PLACES)),
        "all_priced": len(valued) == len(rows) and bool(rows),
    }
