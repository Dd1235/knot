"""Ledger tools: translate agent intent into balanced double-entry legs."""

import hashlib
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.agent.registry import ToolContext, register
from app.ledger import categories, service
from app.ledger.display import to_rupees
from app.ledger.service import LegSpec, UnbalancedTransaction
from app.memory import episodic, writer
from app.tasks import fire_and_forget

TWO_PLACES = Decimal("0.01")
IST = ZoneInfo("Asia/Kolkata")


def _person_account(name: str) -> str:
    return f"receivable:{name.strip().lower()}"


def _utterance_key(ctx: ToolContext, args: dict, amount: Decimal) -> str:
    """One spoken sentence is one transaction, however many clients heard it.

    ARCHITECTURE.md already claimed idempotency keys stopped a double-tapped
    voice command from double-posting; this is the call site that was missing,
    and it mattered because a duplicated voice session dispatches every tool
    twice.

    Keyed on what the user said rather than on a client-supplied id, so two
    independent sessions transcribing one utterance collide deliberately. Two
    genuine chais at the same price a minute apart differ by occurred_at.
    """
    parts = [
        ctx.session_id or "",
        (ctx.user_message or args.get("description", "")).strip().lower(),
        args.get("direction", ""),
        str(amount),
        args.get("occurred_at") or "",
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:40]


def _parse_occurred_at(value: str | None) -> datetime | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=IST) if parsed.tzinfo is None else parsed


# Every leg used to fund itself from `cash`, so someone with a salary account,
# a spending account and a UPI wallet could not say which one moved.
DEFAULT_FUNDING = "cash"
FUNDING_MUST_BE_ASSET = ("expense:", "income:", "liability:", "receivable:", "equity:", "invest:")


def _funding_account(account: str | None) -> str:
    name = (account or DEFAULT_FUNDING).strip().lower()
    if name.startswith(FUNDING_MUST_BE_ASSET):
        raise UnbalancedTransaction(
            f"{name} is not an account money can move from; name a bank, card or wallet"
        )
    return name


def _build_legs(
    direction: str,
    amount: Decimal,
    category: str,
    counterparty: str | None,
    split_with: list[str],
    account: str | None = None,
) -> list[LegSpec]:
    # A SIP or FD debit lands in an asset account, not an expense —
    # the money changed shape, it did not leave.
    expense_account = categories.account_for(category)
    funding = _funding_account(account)
    if direction == "spent" and split_with:
        # User paid the full amount; each person owes an equal share.
        n = len(split_with) + 1
        share = (amount / n).quantize(TWO_PLACES)
        user_share = amount - share * len(split_with)  # absorbs rounding paise
        legs = [LegSpec(funding, -amount), LegSpec(expense_account, user_share)]
        legs += [LegSpec(_person_account(p), share) for p in split_with]
        return legs
    if direction == "spent":
        return [LegSpec(expense_account, amount), LegSpec(funding, -amount)]
    if direction == "received":
        if categories.is_investment(category):
            # cash in + income:stocks leaves the holding on the books and
            # inflates net worth by the whole sale. sell_investment exists
            # precisely so this shape is never posted.
            raise UnbalancedTransaction(
                f"use sell_investment for {category}; recording it as income "
                "would count the holding twice"
            )
        return [LegSpec(funding, amount), LegSpec(f"income:{category}", -amount)]
    if direction == "refund":
        # Credits the ORIGINAL category rather than posting income. A 200
        # refund on 500 of groceries should leave groceries at 300, not show
        # 500 spent and 200 earned — the second is a worse description of the
        # same event, and it inflates both totals.
        return [LegSpec(funding, amount), LegSpec(expense_account, -amount)]
    if direction == "lent":
        if not counterparty:
            raise UnbalancedTransaction("'lent' needs a counterparty name")
        return [LegSpec(_person_account(counterparty), amount), LegSpec(funding, -amount)]
    if direction == "borrowed":
        if not counterparty:
            raise UnbalancedTransaction("'borrowed' needs a counterparty name")
        return [
            LegSpec(funding, amount),
            LegSpec(f"liability:{counterparty.strip().lower()}", -amount),
        ]
    raise UnbalancedTransaction(f"unknown direction: {direction}")


@register(
    "record_transaction",
    "Record a money event as a balanced double-entry transaction. Use for any "
    "statement about spending, receiving, lending, or borrowing money. Amounts "
    "are as the user said them. For 'paid X split N ways', pass the TOTAL "
    "amount and the OTHER "
    "people's names in split_with.",
    {
        "type": "object",
        "properties": {
            "description": {"type": "string", "description": "Short human description"},
            "amount": {
                "type": "number",
                "description": "Total, positive, in whatever unit the user said",
            },
            "direction": {
                "type": "string",
                "enum": ["spent", "received", "refund", "lent", "borrowed"],
                "description": (
                    "'refund' is money back on something already recorded — it "
                    "reduces that category rather than counting as income."
                ),
            },
            "counterparty": {
                "type": "string",
                "description": "Person's name for lent/borrowed",
            },
            "category": {
                "type": "string",
                "description": (
                    f"Lowercase category; prefer one of: {categories.hint()}. "
                    "Invent a new one only if none fits."
                ),
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
            "account": {
                "type": "string",
                "description": (
                    "Which account the money moved from or into, if the user "
                    "named one — 'hdfc', 'bank', 'icici card', 'paytm'. "
                    "Defaults to cash."
                ),
            },
        },
        "required": ["description", "amount", "direction"],
    },
)
async def record_transaction(ctx: ToolContext, args: dict) -> dict:
    # An amount the user states is in the unit they are reading. The ledger is
    # always rupees, so convert once here, at the boundary — never in the model,
    # and never anywhere the stored value could be affected twice.
    amount = to_rupees(args["amount"], ctx.currency)
    if amount <= 0:
        return {"error": "amount must be positive; use direction to express flow"}
    category = (args.get("category") or "general").strip().lower()
    legs = _build_legs(
        args["direction"],
        amount,
        category,
        args.get("counterparty"),
        args.get("split_with") or [],
        args.get("account"),
    )
    posted = await service.post_transaction(
        ctx.user_handle,
        args["description"],
        legs,
        raw_input=ctx.user_message,
        category=category,
        occurred_at=_parse_occurred_at(args.get("occurred_at")),
        idempotency_key=_utterance_key(ctx, args, amount),
    )
    event_text = (
        f"{args['description']} (₹{amount}, {args['direction']}, category {category}"
        + (f", split with {', '.join(args['split_with'])}" if args.get("split_with") else "")
        + ")"
    )
    fire_and_forget(
        episodic.record_event(
            ctx.user_handle, "txn", event_text,
            ref_transaction_id=posted.id, session_id=ctx.session_id,
        ),
        "episodic-txn",
    )
    fire_and_forget(
        writer.process_event(
            ctx.user_handle, event_text, posted.id, args["description"]
        ),
        "memory-writer",
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
            "amount": {
                "type": "number",
                "description": "As the user said it; omit for full settlement",
            },
        },
        "required": ["person"],
    },
)
async def settle_up(ctx: ToolContext, args: dict) -> dict:
    raw_amount = args.get("amount")
    amount = to_rupees(raw_amount, ctx.currency) if raw_amount is not None else None
    posted = await service.settle_up(ctx.user_handle, args["person"], amount)
    fire_and_forget(
        episodic.record_event(
            ctx.user_handle, "settlement", posted.description,
            ref_transaction_id=posted.id, session_id=ctx.session_id,
        ),
        "episodic-settlement",
    )
    return {
        "transaction_id": str(posted.id),
        "description": posted.description,
        "people_balances": await service.person_balances(ctx.user_handle),
    }


@register(
    "repay_debt",
    "Record paying back money the user BORROWED from someone. Use for 'paid "
    "Priya back', 'settled my debt with Arjun'. Omit amount to clear the whole "
    "debt. This is the mirror of settle_up, which is for money owed TO the user.",
    {
        "type": "object",
        "properties": {
            "person": {"type": "string"},
            "amount": {
                "type": "number",
                "description": "As the user said it; omit to repay the full outstanding",
            },
        },
        "required": ["person"],
    },
)
async def repay_debt(ctx: ToolContext, args: dict) -> dict:
    amount = args.get("amount")
    try:
        posted = await service.repay(
            ctx.user_handle,
            args["person"],
            to_rupees(amount, ctx.currency) if amount is not None else None,
            raw_input=ctx.user_message,
        )
    except service.NothingOutstanding as exc:
        return {"error": str(exc)}
    except service.OverSettlement as exc:
        return {"error": str(exc)}
    return {"transaction_id": str(posted.id), "legs": posted.legs}


@register(
    "sell_investment",
    "Record SELLING an investment — stocks, mutual funds, gold, crypto, FD "
    "closure. Use for 'sold my stocks for 60k', 'redeemed the mutual fund'. "
    "Relieves the holding and books the gain or loss; never record a sale as "
    "income. Pass fraction if only part of the holding was sold.",
    {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "description": "What was sold: stocks, mutual_funds, gold, crypto, fd...",
            },
            "proceeds": {"type": "number", "description": "Actually received, as the user said it"},
            "fraction": {
                "type": "number",
                "description": "Portion of the holding sold, 0-1; omit for all of it",
            },
            "description": {"type": "string"},
        },
        "required": ["category", "proceeds"],
    },
)
async def sell_investment(ctx: ToolContext, args: dict) -> dict:
    category = (args["category"] or "").strip().lower()
    try:
        posted = await service.sell_investment(
            ctx.user_handle,
            category,
            to_rupees(args["proceeds"], ctx.currency),
            fraction=Decimal(str(args["fraction"])) if args.get("fraction") else None,
            description=args.get("description") or "",
            raw_input=ctx.user_message,
        )
    except service.LedgerError as exc:
        return {"error": str(exc)}
    gain = next(
        (leg for leg in posted.legs if leg["account"] == "income:capital_gains"), None
    )
    return {
        "transaction_id": str(posted.id),
        "legs": posted.legs,
        # Negated: income legs are credits, and the user wants "I made 12,000".
        "realised_gain": str(-Decimal(gain["amount"])) if gain else "0.00",
    }


@register(
    "void_transaction",
    "Reverse a wrongly recorded transaction with a negating entry (nothing is "
    "deleted). Use when the user disputes an entry ('I never spent that'). Find "
    "the transaction_id via list_recent_transactions first and confirm with the "
    "user before voiding.",
    {
        "type": "object",
        "properties": {
            "transaction_id": {"type": "string"},
            "reason": {"type": "string", "description": "Short reason, e.g. 'user disputed'"},
        },
        "required": ["transaction_id"],
    },
)
async def void_transaction(ctx: ToolContext, args: dict) -> dict:
    posted = await service.void_transaction(
        ctx.user_handle, args["transaction_id"], args.get("reason", "")
    )
    return {
        "reversal_id": str(posted.id),
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
