"""Ledger tools: translate agent intent into balanced double-entry legs."""

from datetime import datetime
from decimal import Decimal

from app.agent.registry import ToolContext, register
from app.ledger import service
from app.ledger.service import LegSpec, UnbalancedTransaction

TWO_PLACES = Decimal("0.01")


def _person_account(name: str) -> str:
    return f"receivable:{name.strip().lower()}"


def _parse_occurred_at(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _build_legs(
    direction: str,
    amount: Decimal,
    category: str,
    counterparty: str | None,
    split_with: list[str],
) -> list[LegSpec]:
    expense_account = f"expense:{category}"
    if direction == "spent" and split_with:
        # User paid the full amount; each person owes an equal share.
        n = len(split_with) + 1
        share = (amount / n).quantize(TWO_PLACES)
        user_share = amount - share * len(split_with)  # absorbs rounding paise
        legs = [LegSpec("cash", -amount), LegSpec(expense_account, user_share)]
        legs += [LegSpec(_person_account(p), share) for p in split_with]
        return legs
    if direction == "spent":
        return [LegSpec(expense_account, amount), LegSpec("cash", -amount)]
    if direction == "received":
        return [LegSpec("cash", amount), LegSpec(f"income:{category}", -amount)]
    if direction == "lent":
        if not counterparty:
            raise UnbalancedTransaction("'lent' needs a counterparty name")
        return [LegSpec(_person_account(counterparty), amount), LegSpec("cash", -amount)]
    if direction == "borrowed":
        if not counterparty:
            raise UnbalancedTransaction("'borrowed' needs a counterparty name")
        return [
            LegSpec("cash", amount),
            LegSpec(f"liability:{counterparty.strip().lower()}", -amount),
        ]
    raise UnbalancedTransaction(f"unknown direction: {direction}")


@register(
    "record_transaction",
    "Record a money event as a balanced double-entry transaction. Use for any "
    "statement about spending, receiving, lending, or borrowing money. Amounts "
    "are INR. For 'paid X split N ways', pass the TOTAL amount and the OTHER "
    "people's names in split_with.",
    {
        "type": "object",
        "properties": {
            "description": {"type": "string", "description": "Short human description"},
            "amount": {"type": "number", "description": "Total amount in INR, positive"},
            "direction": {
                "type": "string",
                "enum": ["spent", "received", "lent", "borrowed"],
            },
            "counterparty": {
                "type": "string",
                "description": "Person's name for lent/borrowed",
            },
            "category": {
                "type": "string",
                "description": "e.g. food, transport, rent, groceries, entertainment",
            },
            "split_with": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Names of OTHER people sharing a 'spent' expense equally",
            },
            "occurred_at": {
                "type": "string",
                "description": "ISO date/datetime if the user said when; omit for now",
            },
        },
        "required": ["description", "amount", "direction"],
    },
)
async def record_transaction(ctx: ToolContext, args: dict) -> dict:
    amount = Decimal(str(args["amount"])).quantize(TWO_PLACES)
    if amount <= 0:
        return {"error": "amount must be positive; use direction to express flow"}
    category = (args.get("category") or "general").strip().lower()
    legs = _build_legs(
        args["direction"],
        amount,
        category,
        args.get("counterparty"),
        args.get("split_with") or [],
    )
    posted = await service.post_transaction(
        ctx.user_handle,
        args["description"],
        legs,
        raw_input=args.get("raw_input", ""),
        category=category,
        occurred_at=_parse_occurred_at(args.get("occurred_at")),
    )
    return {
        "transaction_id": str(posted.id),
        "legs": posted.legs,
        "people_balances": await service.person_balances(ctx.user_handle),
    }


@register(
    "settle_up",
    "Record that a person paid the user back. Omit amount to settle everything "
    "they owe. Rejects settling more than is outstanding.",
    {
        "type": "object",
        "properties": {
            "person": {"type": "string"},
            "amount": {"type": "number", "description": "INR; omit for full settlement"},
        },
        "required": ["person"],
    },
)
async def settle_up(ctx: ToolContext, args: dict) -> dict:
    amount = Decimal(str(args["amount"])).quantize(TWO_PLACES) if args.get("amount") else None
    posted = await service.settle_up(ctx.user_handle, args["person"], amount)
    return {
        "transaction_id": str(posted.id),
        "description": posted.description,
        "people_balances": await service.person_balances(ctx.user_handle),
    }


@register(
    "get_balances",
    "Get current balances: who owes what, and per-account totals. Use for "
    "questions like 'did X pay me back?' or 'how much do I have outstanding?'",
    {"type": "object", "properties": {}},
)
async def get_balances(ctx: ToolContext, args: dict) -> dict:
    return {
        "people": await service.person_balances(ctx.user_handle),
        "accounts": await service.account_balances(ctx.user_handle),
    }


@register(
    "list_recent_transactions",
    "List the user's most recent transactions, newest first.",
    {
        "type": "object",
        "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 50}},
    },
)
async def list_recent_transactions(ctx: ToolContext, args: dict) -> dict:
    txns = await service.recent_transactions(ctx.user_handle, args.get("limit") or 10)
    for txn in txns:
        txn["occurred_at"] = txn["occurred_at"].isoformat()
    return {"transactions": txns}
