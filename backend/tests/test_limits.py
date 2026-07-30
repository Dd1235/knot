"""Limits are judged by pace, not by percentage used."""

import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.ledger import limits, service
from app.ledger.service import LedgerError, LegSpec


@pytest.fixture
def user() -> str:
    return f"limit-{uuid.uuid4().hex[:12]}"


async def spend(user: str, amount: str, category: str = "food") -> None:
    await service.post_transaction(
        user, f"{category} spend",
        [LegSpec(f"expense:{category}", Decimal(amount)), LegSpec("cash", -Decimal(amount))],
        category=category,
    )


def test_pace_separates_the_fifth_from_the_twenty_fifth():
    """Half a limit spent is a crisis early and unremarkable late. A plain
    percentage cannot tell those apart; that is the whole point."""
    # 5,000 of 10,000 on the 5th of a 30-day month.
    early = (0.5) / (5 / 30)
    late = (0.5) / (25 / 30)
    assert round(early, 2) == 3.0
    assert round(late, 2) == 0.6
    assert limits._verdict(early, Decimal("5000"), Decimal("10000")) == "urgent"
    assert limits._verdict(late, Decimal("5000"), Decimal("10000")) == "fine"


def test_spending_past_the_limit_is_over_regardless_of_pace():
    assert limits._verdict(0.2, Decimal("11000"), Decimal("10000")) == "over"


def test_february_is_shorter_and_pace_knows_it():
    _, _, day, days = limits._month_bounds(date(2027, 2, 14))
    assert (day, days) == (14, 28)
    _, _, day, days = limits._month_bounds(date(2028, 2, 14))
    assert (day, days) == (14, 29)  # leap year


def test_the_last_day_of_a_month_is_full_elapsed():
    _, _, day, days = limits._month_bounds(date(2026, 4, 30))
    assert day == days == 30


async def test_a_limit_reports_spend_against_it(user):
    await limits.set_limit(user, Decimal("10000"), scope="category", target="food")
    await spend(user, "2500", "food")
    await spend(user, "900", "shopping")   # a different category must not count

    result = await limits.status(user)
    row = next(r for r in result["limits"] if r["target"] == "food")
    assert Decimal(row["spent"]) == Decimal("2500")
    assert Decimal(row["left"]) == Decimal("7500")
    assert row["share"] == 25.0


async def test_a_total_limit_counts_everything_but_investing(user):
    await limits.set_limit(user, Decimal("50000"))
    await spend(user, "1000", "food")
    await service.post_transaction(
        user, "SIP", [LegSpec("invest:sip", Decimal("15000")), LegSpec("cash", Decimal("-15000"))],
        category="sip",
    )
    result = await limits.status(user)
    total = next(r for r in result["limits"] if r["scope"] == "total")
    # A limit that punished saving would be perverse.
    assert Decimal(total["spent"]) == Decimal("1000")


async def test_clearing_a_limit_stops_reporting_it(user):
    await limits.set_limit(user, Decimal("5000"), scope="group", target="discretionary")
    assert len((await limits.status(user))["limits"]) == 1
    await limits.clear_limit(user, scope="group", target="discretionary")
    assert (await limits.status(user))["limits"] == []


async def test_a_scoped_limit_needs_a_target(user):
    with pytest.raises(LedgerError):
        await limits.set_limit(user, Decimal("5000"), scope="category")


async def test_restating_a_limit_replaces_it(user):
    await limits.set_limit(user, Decimal("5000"), scope="category", target="food")
    await limits.set_limit(user, Decimal("8000"), scope="category", target="food")
    rows = (await limits.status(user))["limits"]
    assert len(rows) == 1
    assert Decimal(rows[0]["limit"]) == Decimal("8000")
