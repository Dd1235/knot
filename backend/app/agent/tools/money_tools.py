"""Money setup tools: opening balances and recurring commitments."""

from decimal import Decimal

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from app.agent.registry import ToolContext, register
from app.db.tx import run_serializable
from app.ledger import analytics, holdings, limits, loans, recurring, service
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
    "Salary or other regular income means direction 'received'. "
    "This is ALSO how you edit one: call it again with the same name to change "
    "the amount, due day or cadence. Use rename_recurring to change the name "
    "itself, and stop_recurring to cancel.",
    {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "e.g. Netflix, Rent, Salary"},
            "amount": {"type": "number", "description": "Amount per period in INR, positive"},
            "cadence": {"type": "string", "enum": ["monthly", "quarterly", "yearly"]},
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
    "transfer_money",
    "Move money between the user's OWN accounts — bank to bank, bank to wallet, "
    "paying a credit card. Use for 'moved 20k from HDFC to ICICI', 'loaded 2000 "
    "into Paytm'. This is not spending and must never be recorded as such. For "
    "an ATM withdrawal use withdraw_cash instead.",
    {
        "type": "object",
        "properties": {
            "amount": {"type": "number"},
            "from_account": {"type": "string", "description": "e.g. hdfc, bank, salary"},
            "to_account": {"type": "string", "description": "e.g. icici, paytm, cash"},
        },
        "required": ["amount", "from_account", "to_account"],
    },
)
async def transfer_money(ctx: ToolContext, args: dict) -> dict:
    amount = Decimal(str(args["amount"])).quantize(TWO_PLACES)
    if amount <= 0:
        return {"error": "amount must be positive"}
    source = (args["from_account"] or "").strip().lower()
    target = (args["to_account"] or "").strip().lower()
    if source == target:
        return {"error": "source and destination are the same account"}
    for name in (source, target):
        if name.startswith(NON_ASSET_PREFIXES):
            return {"error": f"{name} is not one of your own accounts"}
    posted = await service.post_transaction(
        ctx.user_handle,
        f"Moved to {target} from {source}",
        [LegSpec(target, amount), LegSpec(source, -amount)],
        category="transfer",
        raw_input=ctx.user_message,
    )
    return {"transaction_id": str(posted.id), "legs": posted.legs}


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


@register(
    "track_loan",
    "Register a loan or EMI (home, car, bike, personal, education). Use when "
    "the user mentions borrowing from a bank or paying an EMI — 'I have a 5 "
    "lakh car loan at 9% for 5 years', 'my home loan EMI is 42000'. Pass the "
    "EMI if the user knows it; otherwise it is computed. Set already_running "
    "true if the loan started before they began using this app.",
    {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "e.g. Home Loan, Bike Loan"},
            "principal": {"type": "number", "description": "Amount borrowed, INR"},
            "annual_rate": {"type": "number", "description": "Annual interest %, e.g. 8.75"},
            "tenure_months": {"type": "integer", "minimum": 1},
            "emi": {"type": "number", "description": "Monthly payment if known"},
            "lender": {"type": "string"},
            "due_day": {"type": "integer", "minimum": 1, "maximum": 31},
            "already_running": {"type": "boolean"},
        },
        "required": ["name", "principal", "annual_rate", "tenure_months"],
    },
)
async def track_loan(ctx: ToolContext, args: dict) -> dict:
    try:
        loan = await loans.add_loan(
            ctx.user_handle,
            args["name"],
            Decimal(str(args["principal"])),
            Decimal(str(args["annual_rate"])),
            int(args["tenure_months"]),
            emi=Decimal(str(args["emi"])) if args.get("emi") else None,
            lender=args.get("lender") or "",
            due_day=int(args.get("due_day") or 5),
            already_running=bool(args.get("already_running")),
        )
    except LedgerError as exc:
        return {"error": str(exc)}
    return {"loan": loan["name"], "emi": loan["emi"], "account": loan["account_name"]}


@register(
    "list_loans",
    "List the user's loans with outstanding balance, EMI, how much of the next "
    "payment is interest versus principal, and months left. Call this for any "
    "question about debt, EMIs, or when a loan will be paid off.",
    {"type": "object", "properties": {}},
)
async def list_loans(ctx: ToolContext, args: dict) -> dict:
    return await loans.list_loans(ctx.user_handle)


@register(
    "buy_investment",
    "Record BUYING a specific investment with units — shares, mutual fund "
    "units, grams of gold, crypto. Use for 'bought 10 Reliance at 1380', "
    "'20 units of Parag Flexi at 82'. If the user gives only a rupee amount "
    "with no units, use record_transaction with the category instead.",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "e.g. reliance, infy, parag_flexi"},
            "quantity": {"type": "number", "description": "Units, shares or grams bought"},
            "unit_price": {"type": "number", "description": "Price per unit in INR"},
            "kind": {
                "type": "string",
                "enum": ["stocks", "mutual_funds", "gold", "crypto", "bonds", "elss", "etf"],
            },
            "account": {"type": "string", "description": "Paid from; default bank"},
        },
        "required": ["symbol", "quantity", "unit_price"],
    },
)
async def buy_investment(ctx: ToolContext, args: dict) -> dict:
    try:
        return await holdings.buy(
            ctx.user_handle,
            args["symbol"],
            Decimal(str(args["quantity"])),
            Decimal(str(args["unit_price"])),
            kind=(args.get("kind") or "stocks"),
            account=(args.get("account") or "bank").strip().lower(),
            raw_input=ctx.user_message,
        )
    except LedgerError as exc:
        return {"error": str(exc)}


@register(
    "sell_units",
    "Record SELLING units of a specific investment — 'sold 5 Reliance at "
    "1500'. Relieves cost at the weighted average and books the gain or loss. "
    "For a redemption stated only in rupees, use sell_investment instead.",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "quantity": {"type": "number"},
            "unit_price": {"type": "number", "description": "Price per unit received"},
            "kind": {
                "type": "string",
                "enum": ["stocks", "mutual_funds", "gold", "crypto", "bonds", "elss", "etf"],
            },
            "account": {"type": "string", "description": "Proceeds into; default bank"},
        },
        "required": ["symbol", "quantity", "unit_price"],
    },
)
async def sell_units(ctx: ToolContext, args: dict) -> dict:
    try:
        return await holdings.sell(
            ctx.user_handle,
            args["symbol"],
            Decimal(str(args["quantity"])),
            Decimal(str(args["unit_price"])),
            kind=(args.get("kind") or "stocks"),
            account=(args.get("account") or "bank").strip().lower(),
            raw_input=ctx.user_message,
        )
    except LedgerError as exc:
        return {"error": str(exc)}


@register(
    "mark_price",
    "Record what an investment is worth NOW, as the user states it — "
    "'Reliance is at 1450', 'the fund NAV is 82.4'. Updates the valuation "
    "only; it is not a transaction and does not move any money.",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string"},
            "price": {"type": "number", "description": "Current price per unit"},
        },
        "required": ["symbol", "price"],
    },
)
async def mark_price(ctx: ToolContext, args: dict) -> dict:
    try:
        return await holdings.mark_price(
            ctx.user_handle, args["symbol"], Decimal(str(args["price"]))
        )
    except LedgerError as exc:
        return {"error": str(exc)}


@register(
    "list_holdings",
    "The user's investment portfolio: every holding with units, average cost, "
    "current value and unrealised gain, plus realised gains so far. Call this "
    "for any question about investments, portfolio or returns.",
    {"type": "object", "properties": {}},
)
async def list_holdings(ctx: ToolContext, args: dict) -> dict:
    return await holdings.portfolio(ctx.user_handle)


@register(
    "set_limit",
    "Set a monthly spending limit — overall, for a spending group, or for one "
    "category. Use for 'keep me under 10k for food', 'cap discretionary at "
    "15000'. Restating one replaces it. Never suggest a limit unprompted; if "
    "the user asks what a sensible one would be, call suggest_limits first.",
    {
        "type": "object",
        "properties": {
            "amount": {"type": "number", "description": "Monthly cap in INR"},
            "scope": {"type": "string", "enum": ["total", "group", "category"]},
            "target": {
                "type": "string",
                "description": (
                    "Which group (essentials, discretionary, debt) or category "
                    "(food, shopping...). Leave empty for a total limit."
                ),
            },
        },
        "required": ["amount"],
    },
)
async def set_limit(ctx: ToolContext, args: dict) -> dict:
    try:
        row = await limits.set_limit(
            ctx.user_handle,
            Decimal(str(args["amount"])),
            scope=args.get("scope") or "total",
            target=args.get("target") or "",
        )
    except LedgerError as exc:
        return {"error": str(exc)}
    # Return the pace immediately: a limit set mid-month may already be blown,
    # and saying so at once is more useful than waiting for the next check.
    return {"limit": row, "status": await limits.status(ctx.user_handle)}


@register(
    "check_limits",
    "How the user is tracking against their monthly limits: spent so far, "
    "what's left, and whether they're ahead of the calendar. Call this when "
    "they ask how they're doing, or before answering 'can I afford X'.",
    {"type": "object", "properties": {}},
)
async def check_limits(ctx: ToolContext, args: dict) -> dict:
    return await limits.status(ctx.user_handle)


@register(
    "clear_limit",
    "Remove a monthly limit the user set.",
    {
        "type": "object",
        "properties": {
            "scope": {"type": "string", "enum": ["total", "group", "category"]},
            "target": {"type": "string"},
        },
    },
)
async def clear_limit(ctx: ToolContext, args: dict) -> dict:
    row = await limits.clear_limit(
        ctx.user_handle, scope=args.get("scope") or "total", target=args.get("target") or ""
    )
    if row is None:
        return {"error": "no such limit"}
    return {"cleared": row}


@register(
    "suggest_limits",
    "Limits worth offering, computed from the user's own median spending over "
    "the last three months. Use when they ask what a reasonable cap would be, "
    "so the number comes from their life rather than thin air.",
    {"type": "object", "properties": {}},
)
async def suggest_limits(ctx: ToolContext, args: dict) -> dict:
    return {"suggestions": await limits.suggestions(ctx.user_handle)}


@register(
    "upcoming_commitments",
    "What is due next and when — rent, EMIs, subscriptions, and the next time "
    "money arrives. Call this for 'what's coming up', 'what do I owe this "
    "month', or before saying whether something is affordable.",
    {
        "type": "object",
        "properties": {
            "horizon_days": {
                "type": "integer",
                "description": "How far ahead to look; default 45",
            }
        },
    },
)
async def upcoming_commitments(ctx: ToolContext, args: dict) -> dict:
    return await recurring.upcoming(
        ctx.user_handle, horizon_days=int(args.get("horizon_days") or 45)
    )


@register(
    "rename_recurring",
    "Rename a tracked recurring item. Use when the user corrects what "
    "something is called. To change an amount, date or cadence instead, call "
    "track_recurring again with the SAME name — that edits it in place.",
    {
        "type": "object",
        "properties": {
            "old_name": {"type": "string"},
            "new_name": {"type": "string"},
        },
        "required": ["old_name", "new_name"],
    },
)
async def rename_recurring(ctx: ToolContext, args: dict) -> dict:
    try:
        row = await recurring.rename(ctx.user_handle, args["old_name"], args["new_name"])
    except LedgerError as exc:
        return {"error": str(exc)}
    if row is None:
        return {"error": f"nothing tracked called '{args['old_name']}'"}
    return {"renamed": row}
