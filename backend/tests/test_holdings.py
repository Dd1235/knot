"""Per-instrument holdings: units are an annotation, money is the invariant."""

import asyncio
import uuid
from decimal import Decimal

import pytest

from app.ledger import holdings, service
from app.ledger.holdings import OverSale
from app.ledger.service import LedgerError, LegSpec


@pytest.fixture
def user() -> str:
    return f"hold-{uuid.uuid4().hex[:12]}"


async def funded(user: str, amount: str = "500000") -> None:
    await service.post_transaction(
        user, "Opening",
        [LegSpec("bank", Decimal(amount)), LegSpec("equity:opening", -Decimal(amount))],
        category="opening_balance",
    )


def test_account_name_keeps_the_invest_prefix():
    """Every analytics filter matches on LIKE 'invest:%'. Breaking that would
    silently reclassify every holding."""
    name = holdings.account_for("stocks", "Reliance Industries")
    assert name == "invest:stocks:reliance_industries"
    assert service._account_type(name) == "asset"


async def test_buying_units_leaves_net_worth_flat(user):
    from app.ledger import analytics

    await funded(user)
    before = Decimal((await analytics.summary(user, 30))["net_worth"]["net_worth"])
    await holdings.buy(user, "reliance", Decimal("10"), Decimal("1380"))
    after = Decimal((await analytics.summary(user, 30))["net_worth"]["net_worth"])
    assert after == before

    p = await holdings.portfolio(user)
    holding = p["holdings"][0]
    assert Decimal(holding["units"]) == 10
    assert Decimal(holding["cost_basis"]) == Decimal("13800.00")
    assert Decimal(holding["avg_cost"]) == Decimal("1380")


async def test_average_cost_blends_two_buys(user):
    await funded(user)
    await holdings.buy(user, "reliance", Decimal("10"), Decimal("1000"))
    await holdings.buy(user, "reliance", Decimal("10"), Decimal("1400"))
    p = await holdings.portfolio(user)
    assert Decimal(p["holdings"][0]["avg_cost"]) == Decimal("1200")


async def test_selling_relieves_cost_at_average_and_leaves_it_unchanged(user):
    """The property that makes a lots table unnecessary."""
    await funded(user)
    await holdings.buy(user, "reliance", Decimal("10"), Decimal("1000"))
    await holdings.buy(user, "reliance", Decimal("10"), Decimal("1400"))
    result = await holdings.sell(user, "reliance", Decimal("5"), Decimal("1500"))

    assert Decimal(result["cost_relieved"]) == Decimal("6000.00")   # 5 x 1200
    assert Decimal(result["realised_gain"]) == Decimal("1500.00")   # 7500 - 6000

    p = await holdings.portfolio(user)
    holding = p["holdings"][0]
    assert Decimal(holding["units"]) == 15
    assert Decimal(holding["avg_cost"]) == Decimal("1200")


async def test_a_gain_moves_net_worth_by_exactly_the_gain(user):
    from app.ledger import analytics

    await funded(user)
    await holdings.buy(user, "infy", Decimal("20"), Decimal("1500"))
    before = Decimal((await analytics.summary(user, 30))["net_worth"]["net_worth"])
    await holdings.sell(user, "infy", Decimal("20"), Decimal("1750"))
    after = Decimal((await analytics.summary(user, 30))["net_worth"]["net_worth"])
    assert after - before == Decimal("5000")


async def test_cannot_sell_more_units_than_held(user):
    await funded(user)
    await holdings.buy(user, "infy", Decimal("5"), Decimal("1500"))
    with pytest.raises(OverSale):
        await holdings.sell(user, "infy", Decimal("6"), Decimal("1500"))


async def test_cannot_sell_something_never_bought(user):
    await funded(user)
    with pytest.raises(LedgerError):
        await holdings.sell(user, "tcs", Decimal("1"), Decimal("3000"))


async def test_marking_a_price_never_touches_the_ledger(user):
    """An unrealised gain is not a transaction."""
    await funded(user)
    await holdings.buy(user, "reliance", Decimal("10"), Decimal("1380"))
    before = await service.account_balances(user)
    await holdings.mark_price(user, "reliance", Decimal("1500"))
    after = await service.account_balances(user)
    assert {b["name"]: b["balance"] for b in before} == {b["name"]: b["balance"] for b in after}

    p = await holdings.portfolio(user)
    assert Decimal(p["market_value"]) == Decimal("15000.00")
    assert Decimal(p["unrealised"]) == Decimal("1200.00")
    assert Decimal(p["cost_basis"]) == Decimal("13800.00")


async def test_unpriced_holdings_are_carried_at_cost(user):
    """Marking one instrument must not make the portfolio total look smaller."""
    await funded(user)
    await holdings.buy(user, "reliance", Decimal("10"), Decimal("1000"))
    await holdings.buy(user, "infy", Decimal("10"), Decimal("2000"))
    await holdings.mark_price(user, "reliance", Decimal("1100"))
    p = await holdings.portfolio(user)
    # 11,000 marked + 20,000 at cost
    assert Decimal(p["market_value"]) == Decimal("31000.00")
    assert p["all_priced"] is False


async def test_concurrent_sales_cannot_oversell(user):
    await funded(user)
    await holdings.buy(user, "reliance", Decimal("10"), Decimal("1000"))
    results = await asyncio.gather(
        *(holdings.sell(user, "reliance", Decimal("10"), Decimal("1100")) for _ in range(8)),
        return_exceptions=True,
    )
    committed = [r for r in results if not isinstance(r, Exception)]
    assert len(committed) == 1, f"{len(committed)} sales committed, expected 1"

    balances = {b["name"]: Decimal(b["balance"]) for b in await service.account_balances(user)}
    assert sum(balances.values()) == 0


async def test_a_later_buy_does_not_rename_the_instrument(user):
    """Defaulting display_name to the symbol made every subsequent purchase
    look like a rename."""
    await funded(user)
    await holdings.buy(
        user, "reliance", Decimal("10"), Decimal("1350"),
        display_name="Reliance Industries",
    )
    await holdings.buy(user, "reliance", Decimal("5"), Decimal("1400"))
    p = await holdings.portfolio(user)
    assert p["holdings"][0]["display_name"] == "Reliance Industries"
