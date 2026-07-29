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
    """Two sources of truth drift. This makes drift a test failure."""
    async with pool().connection() as conn:
        cur = await conn.execute(
            "SELECT category FROM category_groups WHERE grp = 'savings_invest'"
        )
        in_db = {r[0] for r in await cur.fetchall()}
    assert in_db == set(categories.INVESTMENT_CATEGORIES)


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
