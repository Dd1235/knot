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
    """The spoken number and the rendered number come from one query."""
    await spend(user, "500", "food", "lunch")
    await spend(user, "1200", "groceries", "weekly shop")

    result = await report_tools.financial_overview(ctx_for(user), {})
    summary = await analytics.summary(user, 30)

    assert result["total_spend"] == summary["total_spend"] == "1700.00"
    assert result["net_worth"] == summary["net_worth"]
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
    await spend(user, "300", "food", "dinner")
    assert (await report_tools.safe_to_spend(ctx_for(user), {})) == (
        await analytics.safe_to_spend(user)
    )


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
