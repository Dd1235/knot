"""Selling must relieve the holding, not invent income.

Before this existed the agent reached for `received` + a stock category, which
posted cash in and income:stocks out while leaving the asset on the books —
net worth rose by the whole sale amount.
"""

import asyncio
import uuid
from decimal import Decimal

import pytest

from app.ledger import analytics, categories, service
from app.ledger.service import LegSpec, NothingOutstanding


@pytest.fixture
def user() -> str:
    return f"inv-{uuid.uuid4().hex[:12]}"


async def funded(user: str, amount: str = "100000") -> None:
    await service.post_transaction(
        user, "Opening",
        [LegSpec("bank", Decimal(amount)), LegSpec("equity:opening", -Decimal(amount))],
        category="opening_balance",
    )


async def buy(user: str, category: str, amount: str) -> None:
    await service.post_transaction(
        user, f"bought {category}",
        [LegSpec(categories.account_for(category), Decimal(amount)),
         LegSpec("bank", -Decimal(amount))],
        category=category,
    )


async def test_selling_at_cost_leaves_net_worth_unchanged(user):
    await funded(user)
    before = (await analytics.summary(user, 30))["net_worth"]["net_worth"]
    await buy(user, "stocks", "50000")
    await service.sell_investment(user, "stocks", Decimal("50000"))
    after = (await analytics.summary(user, 30))["net_worth"]["net_worth"]
    assert after == before, "a round trip at cost must be a no-op for net worth"


async def test_a_gain_raises_net_worth_by_exactly_the_gain(user):
    await funded(user)
    before = Decimal((await analytics.summary(user, 30))["net_worth"]["net_worth"])
    await buy(user, "stocks", "50000")
    posted = await service.sell_investment(user, "stocks", Decimal("62000"))
    after = Decimal((await analytics.summary(user, 30))["net_worth"]["net_worth"])
    assert after - before == Decimal("12000")
    gain = next(leg for leg in posted.legs if leg["account"] == "income:capital_gains")
    assert Decimal(gain["amount"]) == Decimal("-12000")


async def test_a_loss_lowers_net_worth_by_exactly_the_loss(user):
    await funded(user)
    before = Decimal((await analytics.summary(user, 30))["net_worth"]["net_worth"])
    await buy(user, "stocks", "50000")
    await service.sell_investment(user, "stocks", Decimal("41000"))
    after = Decimal((await analytics.summary(user, 30))["net_worth"]["net_worth"])
    assert after - before == Decimal("-9000")


async def test_selling_half_relieves_half_the_cost(user):
    await funded(user)
    await buy(user, "stocks", "50000")
    await service.sell_investment(user, "stocks", Decimal("30000"), fraction=Decimal("0.5"))
    balances = {b["name"]: Decimal(b["balance"]) for b in await service.account_balances(user)}
    assert balances["invest:stocks"] == Decimal("25000")


async def test_cannot_sell_what_is_not_held(user):
    await funded(user)
    with pytest.raises(NothingOutstanding):
        await service.sell_investment(user, "stocks", Decimal("1000"))


async def test_a_sale_is_not_spending(user):
    await funded(user)
    await buy(user, "stocks", "50000")
    await service.sell_investment(user, "stocks", Decimal("55000"))
    summary = await analytics.summary(user, 30)
    assert Decimal(summary["total_spend"]) == 0


async def test_recording_a_sale_as_income_is_refused(user):
    """The exact shape that used to double-count."""
    from app.agent.tools.ledger_tools import _build_legs

    with pytest.raises(service.UnbalancedTransaction):
        _build_legs("received", Decimal("50000"), "stocks", None, [])


async def test_concurrent_sales_cannot_relieve_the_same_cost_twice(user):
    await funded(user)
    await buy(user, "stocks", "40000")
    results = await asyncio.gather(
        *(service.sell_investment(user, "stocks", Decimal("40000")) for _ in range(8)),
        return_exceptions=True,
    )
    committed = [r for r in results if not isinstance(r, Exception)]
    assert len(committed) == 1, f"{len(committed)} sales committed, expected 1"

    balances = {b["name"]: Decimal(b["balance"]) for b in await service.account_balances(user)}
    assert balances.get("invest:stocks", Decimal("0")) == 0
    assert sum(balances.values()) == 0, "the ledger must still sum to zero"
