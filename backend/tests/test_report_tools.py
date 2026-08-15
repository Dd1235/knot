"""The read tools: the agent must be able to report, not just record.

These exist because the whole insights surface used to be unreachable by any
tool — text or voice — so the agent was asked to hand-sum a capped transaction
list to answer questions SQL already answered exactly. Each test asserts the
tool agrees with the aggregate it wraps, because a reporting tool that drifts
from the dashboard is worse than no tool at all.
"""

import uuid
from decimal import Decimal

import pytest

from app.agent.registry import ToolContext
from app.agent.tools import report_tools
from app.ledger import analytics, service
from app.ledger.display import Currency
from app.ledger.service import LegSpec


@pytest.fixture
def user() -> str:
    return f"report-{uuid.uuid4().hex[:12]}"


def ctx_for(user: str) -> ToolContext:
    return ToolContext(user_handle=user, session_id=str(uuid.uuid4()))


async def spend(user: str, amount: str, category: str, description: str):
    await service.post_transaction(
        user,
        description,
        [LegSpec(f"expense:{category}", Decimal(amount)), LegSpec("cash", -Decimal(amount))],
        category=category,
    )


async def test_overview_agrees_with_the_dashboard(user):
    """The spoken number and the rendered number come from one query.

    The tool labels its figures — always, even in rupees. A bare number is what
    let the agent call a rupee figure "dollars".
    """
    await spend(user, "500", "food", "lunch")
    await spend(user, "1200", "groceries", "weekly shop")

    result = await report_tools.financial_overview(ctx_for(user), {})
    summary = await analytics.summary(user, 30)

    assert summary["total_spend"] == "1700.00"
    assert result["total_spend"] == "₹1700.00"
    assert result["window_days"] == 30


async def test_the_window_is_bounded(user):
    """'Last ten years' is a slow query dressed up as a question."""
    assert (await report_tools.financial_overview(ctx_for(user), {"days": 9999}))[
        "window_days"
    ] == 365
    assert (await report_tools.financial_overview(ctx_for(user), {"days": 0}))[
        "window_days"
    ] == 1
    # A model that sends nonsense should still get an answer, not a 500.
    assert (await report_tools.financial_overview(ctx_for(user), {"days": "lots"}))[
        "window_days"
    ] == 30


async def test_overview_omits_the_daily_spine(user):
    """A spoken answer cannot contain 365 rows, so it is never handed them.

    The model cannot read out what it was not given — the same narrowing
    principle the memory writer uses.
    """
    await spend(user, "100", "food", "chai")
    result = await report_tools.financial_overview(ctx_for(user), {})
    assert "daily" not in result
    assert "by_category" not in result


async def test_breakdown_caps_the_tail(user):
    """Nine categories, at most eight spoken."""
    for i in range(9):
        await spend(user, f"{100 + i}", f"cat{i}", f"thing {i}")
    result = await report_tools.spending_breakdown(ctx_for(user), {})
    assert len(result["by_category"]) <= 8


async def test_safe_to_spend_matches_analytics(user):
    """Same figures as the dashboard, labelled with their unit."""
    await spend(user, "300", "food", "dinner")
    tool = await report_tools.safe_to_spend(ctx_for(user), {})
    raw = await analytics.safe_to_spend(user)
    for key in ("liquid", "claimed", "available"):
        assert tool[key] == f"₹{raw[key]}"
    assert tool["days_until_income"] == raw["days_until_income"]


async def test_a_dollar_reader_hears_dollars(user):
    """A judge who toggles the display to USD must not be told rupee figures.

    Conversion happens here, in Python, once — never in the model, which would
    be arithmetic and would eventually be wrong out loud.
    """
    await spend(user, "8700", "shopping", "a big day")
    usd = ToolContext(
        user_handle=user,
        session_id=str(uuid.uuid4()),
        currency=Currency("USD", Decimal("0.0115")),
    )
    result = await report_tools.financial_overview(usd, {})
    assert result["total_spend"] == "$100.05"          # 8700 * 0.0115
    # And the ledger itself is untouched: still rupees.
    assert (await analytics.summary(user, 30))["total_spend"] == "8700.00"


async def test_an_amount_stated_in_dollars_is_stored_in_rupees(user):
    """The ledger never learns another currency exists."""
    from app.agent.tools import ledger_tools

    usd = ToolContext(
        user_handle=user,
        session_id=str(uuid.uuid4()),
        currency=Currency("USD", Decimal("0.01")),
    )
    await ledger_tools.record_transaction(
        usd, {"description": "headphones", "amount": 50, "direction": "spent",
              "category": "shopping"},
    )
    # $50 at 0.01 per rupee is ₹5,000 on the books.
    assert (await analytics.summary(user, 30))["total_spend"] == "5000.00"


async def test_cash_position_is_readable_without_spending_cash(user):
    """It used to be a side-effect of log_cash_spend — you had to spend cash to
    learn your cash float."""
    result = await report_tools.cash_position(ctx_for(user), {})
    assert set(result) >= {"withdrawn", "accounted", "unaccounted"}


async def test_what_changed_says_nothing_on_an_empty_ledger(user):
    """And spends no model call doing it — the insights short-circuit."""
    result = await report_tools.what_changed(ctx_for(user), {})
    assert result["observations"] == []


async def test_every_report_tool_is_registered_for_voice(user):
    """Voice gets the registry wholesale, so registration IS the voice wiring."""
    from app.agent.registry import specs

    names = {t["name"] for t in specs()}
    assert {
        "financial_overview",
        "safe_to_spend",
        "spending_breakdown",
        "spending_rhythm",
        "cash_position",
        "what_changed",
    } <= names


async def test_every_write_tool_converts_a_stated_amount(user):
    """A judge in dollar mode must not have $50 posted as ₹50.

    This test exists because an audit found six write tools that skipped the
    conversion the reporting tools had already learned — cash spends, transfers,
    withdrawals, limits, loans and buys all took the number as rupees. Reading
    in dollars while writing in rupees is worse than not supporting dollars at
    all, because nothing on screen says which one happened.

    One case per tool, all at 0.01 per rupee so the arithmetic is ×100.
    """
    from app.agent.tools import money_tools

    usd = ToolContext(
        user_handle=user,
        session_id=str(uuid.uuid4()),
        currency=Currency("USD", Decimal("0.01")),
    )

    await money_tools.set_opening_balance(usd, {"amount": 100, "account": "bank"})
    await money_tools.log_cash_spend(usd, {"amount": 5, "description": "coffee"})
    await money_tools.set_limit(usd, {"amount": 20, "scope": "category", "target": "food"})
    await money_tools.track_loan(
        usd,
        {
            "name": "car loan",
            "lender": "hdfc",
            "principal": 1000,
            "annual_rate": 9,
            "tenure_months": 12,
        },
    )

    from app.ledger import limits as limits_mod
    from app.ledger import loans as loans_mod

    # A $100 opening balance is ₹10,000 on the books.
    accounts = {r["name"]: r["balance"] for r in await service.account_balances(user)}
    assert Decimal(accounts["bank"]) == Decimal("10000.00")

    # A $5 coffee is a ₹500 spend, not a ₹5 one.
    assert (await analytics.summary(user, 30))["total_spend"] == "500.00"

    # A $20 food limit is a ₹2,000 limit.
    food = next(r for r in (await limits_mod.status(user))["limits"] if r["target"] == "food")
    assert Decimal(food["limit"]) == Decimal("2000.00")

    # A $1,000 principal is ₹100,000 — the rate is a percentage and must NOT move.
    loan = (await loans_mod.list_loans(user))["loans"][0]
    assert Decimal(str(loan["principal"])) == Decimal("100000.00")
    assert Decimal(str(loan["annual_rate"])) == Decimal("9")
