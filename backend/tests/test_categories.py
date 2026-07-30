"""Investing is not spending — the accounting has to agree with the dashboard."""

import uuid
from decimal import Decimal

import pytest

from app.db.pool import pool
from app.ledger import analytics, categories, service
from app.ledger.service import LegSpec


def test_investment_routes_to_an_asset_not_an_expense():
    assert categories.account_for("sip") == "invest:sip"
    assert categories.account_for("nps") == "invest:nps"
    assert categories.account_for("food") == "expense:food"
    # An investment account must type as an asset, or net worth falls when the
    # user saves — the exact bug this module exists to prevent.
    assert service._account_type("invest:sip") == "asset"


@pytest.mark.asyncio
async def test_python_taxonomy_matches_the_database():
    """Two sources of truth drift. This makes drift a test failure.

    Widened from savings_invest to the whole taxonomy after the hand-written
    category list in the agent's tool schema was found to be nine categories
    behind the database — the model could not route to what it was never shown.
    """
    async with pool().connection() as conn:
        cur = await conn.execute("SELECT category, grp FROM category_groups")
        in_db: dict[str, str] = dict(await cur.fetchall())

    in_python = {c: grp for grp, cats in categories.TAXONOMY.items() for c in cats}
    assert in_db == in_python
    assert set(categories.INVESTMENT_CATEGORIES) == set(categories.TAXONOMY["savings_invest"])
    # Everything shown to the model is either grouped by the database or is an
    # income category grouped by account type instead.
    shown = categories.hint().split(", ")
    assert all(c in in_db or c in categories.INCOME_CATEGORIES for c in shown)
    # Internal transfer categories are never offered as something to say.
    assert not (set(shown) & categories.INTERNAL)


@pytest.mark.asyncio
async def test_a_sip_leaves_net_worth_flat_and_out_of_spend():
    handle = f"invest-{uuid.uuid4().hex[:8]}"
    await service.post_transaction(
        handle, "Opening", [LegSpec("bank", Decimal("50000")),
                            LegSpec("equity:opening", Decimal("-50000"))],
        category="opening_balance",
    )
    before = await analytics.summary(handle, days=30)

    await service.post_transaction(
        handle, "Monthly SIP", [LegSpec(categories.account_for("sip"), Decimal("10000")),
                                LegSpec("bank", Decimal("-10000"))],
        category="sip",
    )
    await service.post_transaction(
        handle, "Swiggy", [LegSpec("expense:food", Decimal("400")),
                           LegSpec("bank", Decimal("-400"))],
        category="food",
    )
    after = await analytics.summary(handle, days=30)

    # ₹10,000 moved from bank into a fund. Nothing was consumed.
    assert Decimal(after["net_worth"]["net_worth"]) == Decimal(
        before["net_worth"]["net_worth"]
    ) - Decimal("400")
    assert Decimal(after["total_spend"]) == Decimal("400")
    assert Decimal(after["total_invested"]) == Decimal("10000")
    assert "sip" not in {c["category"] for c in after["by_category"]}

    # ...but you cannot spend a mutual fund, so it is not safe-to-spend money.
    safe = await analytics.safe_to_spend(handle)
    assert Decimal(safe["liquid"]) == Decimal("39600")


@pytest.mark.asyncio
async def test_daily_spine_separates_invested_from_spent():
    """The heatmap shades `spend`; a SIP day must not read as a heavy day."""
    handle = f"heat-{uuid.uuid4().hex[:8]}"
    await service.post_transaction(
        handle, "SIP", [LegSpec("invest:sip", Decimal("25000")),
                        LegSpec("bank", Decimal("-25000"))], category="sip",
    )
    await service.post_transaction(
        handle, "Chai", [LegSpec("expense:food", Decimal("20")),
                         LegSpec("bank", Decimal("-20"))], category="food",
    )
    daily = (await analytics.summary(handle, days=2))["daily"]
    today = daily[-1]
    assert Decimal(today["spend"]) == Decimal("20")
    assert Decimal(today["invested"]) == Decimal("25000")
    assert today["txns"] == 2


@pytest.mark.asyncio
async def test_rent_received_is_income_not_an_essential_expense():
    """One flat category cannot serve both directions. `rent` maps to
    essentials, so a landlord's rental income rendered as an expense."""
    handle = f"landlord-{uuid.uuid4().hex[:8]}"
    await service.post_transaction(
        handle, "rent from tenant",
        [LegSpec("bank", Decimal("18000")), LegSpec("income:rent", Decimal("-18000"))],
        category="rent",
    )
    row = (await service.recent_transactions(handle, limit=1))[0]
    assert row["direction"] == "received"
    assert row["grp"] == "income"


@pytest.mark.asyncio
async def test_interest_paid_is_debt_not_income():
    """`interest` was mapped to the income group, so interest PAID on a loan
    appeared inside the income slice of a spending breakdown."""
    handle = f"borrower-{uuid.uuid4().hex[:8]}"
    await service.post_transaction(
        handle, "loan interest",
        [LegSpec("expense:interest", Decimal("1400")), LegSpec("bank", Decimal("-1400"))],
        category="interest",
    )
    row = (await service.recent_transactions(handle, limit=1))[0]
    assert row["direction"] == "spent"
    assert row["grp"] == "debt"


@pytest.mark.asyncio
async def test_repaying_a_debt_groups_as_debt_not_spending():
    handle = f"repay-{uuid.uuid4().hex[:8]}"
    await service.post_transaction(
        handle, "borrowed", [LegSpec("cash", Decimal("2000")),
                             LegSpec("liability:sam", Decimal("-2000"))], category="loan",
    )
    await service.repay(handle, "sam", Decimal("500"))
    row = (await service.recent_transactions(handle, limit=1))[0]
    assert row["direction"] == "repaid"
    assert row["grp"] == "debt"
