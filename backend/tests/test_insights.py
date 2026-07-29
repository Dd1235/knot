"""Insights: the model phrases facts, it never computes them."""

import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.db.pool import close_pool, open_pool
from app.insights import service
from app.ledger import analytics
from app.ledger import service as ledger
from app.ledger.service import LegSpec

IST = ZoneInfo("Asia/Kolkata")


@pytest.fixture(scope="session", autouse=True)
async def _pool():
    await open_pool()
    yield
    await close_pool()


@pytest.fixture
def user() -> str:
    return f"instest-{uuid.uuid4().hex[:12]}"


async def spend(user: str, amount: str, category: str, days_ago: int):
    when = datetime.now(IST) - timedelta(days=days_ago)
    await ledger.post_transaction(
        user,
        f"{category} spend",
        [LegSpec(f"expense:{category}", Decimal(amount)), LegSpec("cash", -Decimal(amount))],
        category=category,
        occurred_at=when,
    )


async def test_prior_window_does_not_overlap_current(user):
    """offset_days must shift the window cleanly, or every delta is wrong."""
    await spend(user, "500", "food", days_ago=1)  # current 7-day window
    await spend(user, "300", "food", days_ago=9)  # prior 7-day window

    current = await analytics.summary(user, 7)
    prior = await analytics.summary(user, 7, offset_days=7)

    assert current["total_spend"] == "500.00"
    assert prior["total_spend"] == "300.00"


async def test_computed_facts_carry_the_arithmetic(user):
    """Every number the model sees is computed here — it only phrases them."""
    await spend(user, "1000", "food", days_ago=2)
    await spend(user, "400", "food", days_ago=10)

    facts = await service._compute_facts(user, 7)

    assert facts["total_spend"] == "1000.00"
    assert facts["prior_total_spend"] == "400.00"
    assert facts["total_spend_change_pct"] == 150.0
    mover = next(m for m in facts["movers"] if m["category"] == "food")
    assert mover["change_pct"] == 150.0
    assert mover["direction"] == "up"


async def test_immaterial_and_unchanged_categories_are_not_movers(user):
    await spend(user, "50", "food", days_ago=1)  # below the material floor
    await spend(user, "1000", "rent", days_ago=1)
    await spend(user, "1000", "rent", days_ago=9)  # flat: not a mover

    facts = await service._compute_facts(user, 7)
    categories = {m["category"] for m in facts["movers"]}
    assert "food" not in categories
    assert "rent" not in categories


async def test_empty_ledger_returns_no_insights_without_calling_the_model(user):
    result = await service.generate(user, days=30)
    assert result["insights"] == []
    assert result["cached"] is False
    # facts ride along so the UI can render movers without a second call
    assert "facts" in result
