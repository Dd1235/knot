"""Money setup tools: opening balances and recurring commitments."""

from decimal import Decimal

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from app.agent.registry import ToolContext, register
from app.db.tx import run_serializable
from app.ledger import analytics, recurring, service
from app.ledger.service import LedgerError, LegSpec

TWO_PLACES = Decimal("0.01")
# An opening balance is posted as a debit, so only spendable (asset) accounts
# make sense — a liability target would invert net worth.
NON_ASSET_PREFIXES = ("expense:", "income:", "liability:", "receivable:", "equity:")

OPENING_CATEGORY = "opening_balance"


class OpeningBalanceExists(LedgerError):
    pass


async def set_opening_balance_for(
    user_handle: str, amount: Decimal, account: str = "cash"
) -> service.PostedTransaction:
    """Post [<account> +amount, equity:opening -amount] exactly once per account.

    The duplicate check and the insert share one serializable transaction, so
    two concurrent calls cannot both slip through.
    """
    amount = Decimal(amount).quantize(TWO_PLACES)
    account = (account or "cash").strip().lower()
    if account.startswith(NON_ASSET_PREFIXES):
        raise OpeningBalanceExists(
            f"{account} is not a spendable account — an opening balance is a debit "
            "and would invert net worth. Use a cash or bank account."
        )
    if amount <= 0:
        raise LedgerError("opening balance must be positive")

    async def _fn(conn: AsyncConnection) -> service.PostedTransaction:
        user_id = await service.ensure_user(conn, user_handle)
        cur = await conn.execute(
            """
            SELECT t.description,
                   ((t.occurred_at AT TIME ZONE 'Asia/Kolkata')::DATE)::STRING AS on_date,
                   (SELECT COALESCE(SUM(l2.amount) FILTER (WHERE l2.amount > 0), 0)
                    FROM transaction_legs AS l2
                    WHERE l2.transaction_id = t.id)::STRING AS amount
            FROM transactions AS t
            WHERE t.user_id = %s AND t.category = %s
              AND EXISTS (SELECT 1 FROM transaction_legs AS l
                          JOIN accounts AS a ON a.id = l.account_id
                          WHERE l.transaction_id = t.id AND a.name = %s)
              AND NOT EXISTS (SELECT 1 FROM transactions AS v
                              WHERE v.user_id = t.user_id
                                AND v.metadata->>'voids' = t.id::STRING)
            LIMIT 1
            """,
            (user_id, OPENING_CATEGORY, account),
        )
        cur.row_factory = dict_row
        existing = await cur.fetchone()
        if existing:
            raise OpeningBalanceExists(
                f"an opening balance for '{account}' already exists: "
                f"'{existing['description']}' of ₹{existing['amount']} "
                f"on {existing['on_date']}. Void it first to set a new one."
            )
        return await service._post_in_conn(
            conn,
            user_id,
            f"Opening balance ({account})",
            [LegSpec(account, amount), LegSpec("equity:opening", -amount)],
            source="system",
            category=OPENING_CATEGORY,
        )

    return await run_serializable(_fn)


@register(
    "set_opening_balance",
    "Set the user's starting balance for an account (default cash). Use when the "
    "user states what they currently have ('I have 40k in my account'). Posts a "
    "one-time opening entry balanced against equity:opening; rejects a second "
    "opening balance for the same account.",
    {
        "type": "object",
        "properties": {
            "amount": {"type": "number", "description": "Current balance in INR, positive"},
            "account": {
                "type": "string",
                "description": "Target account, e.g. cash or bank; default cash",
            },
        },
        "required": ["amount"],
    },
)
async def set_opening_balance(ctx: ToolContext, args: dict) -> dict:
    amount = Decimal(str(args["amount"])).quantize(TWO_PLACES)
    if amount <= 0:
        return {"error": "amount must be positive"}
    account = (args.get("account") or "cash").strip().lower()
    posted = await set_opening_balance_for(ctx.user_handle, amount, account)
    return {
        "transaction_id": str(posted.id),
        "account": account,
        "legs": posted.legs,
    }


@register(
    "track_recurring",
    "Track a recurring commitment (subscription, rent, EMI, salary). It will be "
    "auto-posted to the ledger each period — do NOT also record it manually. "
    "Salary or other regular income means direction 'received'.",
    {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "e.g. Netflix, Rent, Salary"},
            "amount": {"type": "number", "description": "Amount per period in INR, positive"},
            "cadence": {"type": "string", "enum": ["monthly", "yearly"]},
            "due_day": {
                "type": "integer",
                "minimum": 1,
                "maximum": 31,
                "description": "Day of month it is due (monthly cadence)",
            },
            "category": {
                "type": "string",
                "description": "e.g. subscriptions, rent, emi, salary; default subscriptions",
            },
            "direction": {"type": "string", "enum": ["spent", "received"]},
        },
        "required": ["name", "amount"],
    },
)
async def track_recurring(ctx: ToolContext, args: dict) -> dict:
    commitment = await recurring.upsert_commitment(
        ctx.user_handle,
        args["name"],
        Decimal(str(args["amount"])),
        cadence=args.get("cadence") or "monthly",
        due_day=args.get("due_day"),
        category=args.get("category") or "subscriptions",
        direction=args.get("direction") or "spent",
    )
    listed = await recurring.list_commitments(ctx.user_handle)
    return {"commitment": commitment, "monthly_total": listed["monthly_total"]}


@register(
    "list_recurring",
    "List the user's recurring commitments and their combined monthly outflow. "
    "Call this when discussing monthly spending patterns or budgets.",
    {"type": "object", "properties": {}},
)
async def list_recurring(ctx: ToolContext, args: dict) -> dict:
    return await recurring.list_commitments(ctx.user_handle)


@register(
    "stop_recurring",
    "Stop tracking a recurring commitment (user cancelled a subscription, rent "
    "ended). It stops auto-posting; past entries stay on the books.",
    {
        "type": "object",
        "properties": {"name": {"type": "string"}},
        "required": ["name"],
    },
)
async def stop_recurring(ctx: ToolContext, args: dict) -> dict:
    row = await recurring.deactivate(ctx.user_handle, args["name"])
    if row is None:
        return {"error": f"no recurring commitment named '{args['name']}'"}
    listed = await recurring.list_commitments(ctx.user_handle)
    return {"stopped": row["name"], "monthly_total": listed["monthly_total"]}


@register(
    "withdraw_cash",
    "Record taking physical cash out of a bank/ATM. This is a transfer, not "
    "spending — it moves money from the account into cash in hand. Use for "
    "'took out 5000 from the ATM' or 'withdrew 2000'.",
    {
        "type": "object",
        "properties": {
            "amount": {"type": "number", "description": "INR withdrawn"},
            "account": {
                "type": "string",
                "description": "Account it came from, default 'bank'",
            },
        },
        "required": ["amount"],
    },
)
async def withdraw_cash(ctx: ToolContext, args: dict) -> dict:
    amount = Decimal(str(args["amount"])).quantize(TWO_PLACES)
    if amount <= 0:
        return {"error": "amount must be positive"}
    source = (args.get("account") or "bank").strip().lower()
    posted = await service.post_transaction(
        ctx.user_handle,
        f"Cash withdrawn from {source}",
        [LegSpec("cash", amount), LegSpec(source, -amount)],
        category="withdrawal",
        raw_input=ctx.user_message,
    )
    cash = await analytics.cash_float(ctx.user_handle)
    return {"transaction_id": str(posted.id), "cash_in_hand": cash}


@register(
    "log_cash_spend",
    "Record spending physical cash. Use when the user says something was paid "
    "in cash ('paid 200 cash for vegetables', 'gave the auto 60 in cash'). "
    "This is what closes the loop on money withdrawn from an ATM.",
    {
        "type": "object",
        "properties": {
            "amount": {"type": "number"},
            "description": {"type": "string"},
            "category": {"type": "string", "description": "e.g. groceries, transport, food"},
        },
        "required": ["amount", "description"],
    },
)
async def log_cash_spend(ctx: ToolContext, args: dict) -> dict:
    amount = Decimal(str(args["amount"])).quantize(TWO_PLACES)
    if amount <= 0:
        return {"error": "amount must be positive"}
    category = (args.get("category") or "general").strip().lower()
    posted = await service.post_transaction(
        ctx.user_handle,
        args["description"],
        [LegSpec(f"expense:{category}", amount), LegSpec("cash", -amount)],
        category=category,
        raw_input=ctx.user_message,
    )
    cash = await analytics.cash_float(ctx.user_handle)
    return {
        "transaction_id": str(posted.id),
        "still_unaccounted": cash["unaccounted"],
    }
