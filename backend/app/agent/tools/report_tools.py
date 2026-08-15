"""Read tools: everything the dashboards show, spoken.

Until these existed the agent could *record* money but could not *report* on
it. Net worth, safe-to-spend, spending groups, top movers, cash float and the
"what I notice" observations were reachable only by the frontend's fetch, so
the entire insights page was invisible to text and voice alike — and the system
prompt compensated by asking the model to hand-sum `list_recent_transactions`,
which is arithmetic the model should never be doing and which silently truncates
at fifty rows.

Every function here is a thin wrapper over an aggregate that already exists and
is already tested. Nothing computes; SQL computes and the model phrases. That
is also what makes the app usable with the screen off: a dashboard nobody can
see is just a query somebody can ask.
"""

from app.agent.registry import ToolContext, register
from app.insights import service as insights_service
from app.ledger import analytics
from app.ledger.display import money_fields, to_display

# Windows the model may ask for. Bounded because "last 3650 days" is a slow
# query dressed up as a question.
_WINDOW = {
    "type": "integer",
    "minimum": 1,
    "maximum": 365,
    "description": "Days to look back. Default 30.",
}


def _days(args: dict) -> int:
    # `args.get("days") or 30` was wrong: 0 is falsy, so a model sending 0 got
    # a 30-day window while the clamp below looked like it was in charge. An
    # explicit None check keeps "unspecified" and "zero" as different answers,
    # and 0 then clamps to the schema's own minimum.
    raw = args.get("days")
    if raw is None:
        return 30
    try:
        return max(1, min(365, int(raw)))
    except (TypeError, ValueError):
        return 30


@register(
    "financial_overview",
    "The headline numbers: net worth, what was spent, earned and invested over "
    "a window, net cashflow, and how much is safe to spend before the next "
    "income. Use this for broad questions — 'how am I doing?', 'what's my net "
    "worth?', 'read me my finances' — instead of listing transactions.",
    {"type": "object", "properties": {"days": _WINDOW}},
)
async def financial_overview(ctx: ToolContext, args: dict) -> dict:
    days = _days(args)
    summary = await analytics.summary(ctx.user_handle, days)
    safe = await analytics.safe_to_spend(ctx.user_handle)
    # Deliberately NOT the whole summary: `daily` is a per-day spine of up to
    # 365 rows and `by_category` can be long. A spoken answer needs the
    # headline, and the model cannot read out what it was not given.
    c = ctx.currency
    money = ("total_spend", "total_income", "total_invested", "net_cashflow")
    return {
        "window_days": summary["window_days"],
        **{k: to_display(summary[k], c) for k in money},
        "net_worth": money_fields(
            summary["net_worth"], ("assets", "liabilities", "net_worth"), c
        ),
        "by_group": [money_fields(g, ("amount",), c) for g in summary["by_group"]],
        "safe_to_spend": to_display(safe["available"], c),
        "days_until_income": safe["days_until_income"],
        "per_day_until_income": (
            to_display(safe["per_day"], c) if safe["per_day"] is not None else None
        ),
    }


@register(
    "safe_to_spend",
    "How much is genuinely free to spend before the next expected income, "
    "after money already committed to upcoming bills. Use for 'can I afford "
    "this?' and 'how much do I have left?'.",
    {"type": "object", "properties": {}},
)
async def safe_to_spend(ctx: ToolContext, args: dict) -> dict:
    data = await analytics.safe_to_spend(ctx.user_handle)
    return money_fields(data, ("liquid", "claimed", "available", "per_day"), ctx.currency)


@register(
    "spending_breakdown",
    "Where the money went, split by spending group (essentials, discretionary, "
    "savings, debt) and by category. Use for 'what am I spending on?'.",
    {"type": "object", "properties": {"days": _WINDOW}},
)
async def spending_breakdown(ctx: ToolContext, args: dict) -> dict:
    days = _days(args)
    summary = await analytics.summary(ctx.user_handle, days)
    c = ctx.currency
    return {
        "window_days": summary["window_days"],
        "total_spend": to_display(summary["total_spend"], c),
        "by_group": [money_fields(g, ("amount",), c) for g in summary["by_group"]],
        # Top categories only: the tail is noise in a spoken answer.
        "by_category": [
            money_fields(row, ("amount",), c) for row in summary["by_category"][:8]
        ],
    }


@register(
    "spending_rhythm",
    "The shape of the user's habits rather than the totals: which merchants "
    "recur most often (ranked by how often, not how much), how many days had "
    "any spending, and what a typical day of each weekday looks like.",
    {"type": "object", "properties": {"days": _WINDOW}},
)
async def spending_rhythm(ctx: ToolContext, args: dict) -> dict:
    data = await analytics.rhythm(ctx.user_handle, _days(args))
    c = ctx.currency
    return {
        **data,
        "top_merchants": [money_fields(m, ("amount",), c) for m in data["top_merchants"]],
        "by_weekday": [money_fields(d, ("typical",), c) for d in data["by_weekday"]],
    }


@register(
    "cash_position",
    "Physical cash: how much was withdrawn, how much of it has been accounted "
    "for by logged cash spending, and how much is still unexplained.",
    {"type": "object", "properties": {}},
)
async def cash_position(ctx: ToolContext, args: dict) -> dict:
    data = await analytics.cash_float(ctx.user_handle)
    return money_fields(data, ("withdrawn", "accounted", "unaccounted"), ctx.currency)


@register(
    "what_changed",
    "Notable observations about the user's spending — what moved, what is new, "
    "what is unusual — computed from the ledger and phrased as short "
    "sentences. Use when asked 'anything I should know?' or 'what changed?'.",
    {"type": "object", "properties": {"days": _WINDOW}},
)
async def what_changed(ctx: ToolContext, args: dict) -> dict:
    # refresh=False on purpose: this reuses the same 12-hour cached generation
    # the insights page shows, so the spoken answer and the screen agree, and
    # asking by voice costs nothing extra.
    result = await insights_service.generate(ctx.user_handle, _days(args), refresh=False)
    return {
        "observations": [i["text"] for i in result["insights"]],
        "cached": result["cached"],
        # These are sentences a model already wrote, with rupee figures baked
        # into the prose — there is no field to convert. Say so rather than
        # letting the unit be guessed.
        **({} if ctx.currency.is_rupees else {"note": "figures in these sentences are rupees"}),
    }
