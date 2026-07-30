"""Borrowed money must be repayable, and the repayment must survive a race.

`borrowed` created a liability account that nothing ever credited, so a debt
could be recorded and never cleared. settle_up only knew about receivables.
"""

import asyncio
import uuid
from decimal import Decimal

import pytest

from app.ledger import service
from app.ledger.service import LegSpec, NothingOutstanding, OverSettlement


@pytest.fixture
def user() -> str:
    return f"debt-{uuid.uuid4().hex[:12]}"


async def borrow(user: str, amount: str, person: str = "priya"):
    return await service.post_transaction(
        user,
        f"borrowed from {person}",
        [LegSpec("cash", Decimal(amount)), LegSpec(f"liability:{person}", -Decimal(amount))],
        category="loan",
    )


async def test_repaying_clears_the_debt(user):
    await borrow(user, "5000")
    await service.repay(user, "priya")
    balances = await service.account_balances(user)
    owed = {b["name"]: Decimal(b["balance"]) for b in balances}
    assert owed.get("liability:priya", Decimal("0")) == 0


async def test_partial_repayment_leaves_the_rest(user):
    await borrow(user, "5000")
    await service.repay(user, "priya", Decimal("2000"))
    balances = {b["name"]: Decimal(b["balance"]) for b in await service.account_balances(user)}
    # Still owe 3000; a liability carries a negative balance.
    assert balances["liability:priya"] == Decimal("-3000")


async def test_cannot_repay_more_than_owed(user):
    await borrow(user, "1000")
    with pytest.raises(OverSettlement):
        await service.repay(user, "priya", Decimal("1500"))


async def test_cannot_repay_a_debt_that_does_not_exist(user):
    with pytest.raises(NothingOutstanding):
        await service.repay(user, "nobody")


async def test_the_lender_becomes_a_person_you_owe(user):
    """liability accounts had person_id NULL, so they never appeared in the
    who-owes-who list and "who do I owe" was unanswerable."""
    await borrow(user, "800", person="arjun")
    people = await service.person_balances(user)
    arjun = next(p for p in people if p["display_name"] == "Arjun")
    assert Decimal(arjun["balance"]) == Decimal("-800")


async def test_lending_and_borrowing_from_one_person_net_off(user):
    await service.post_transaction(
        user, "lent Meera", [LegSpec("receivable:meera", Decimal("500")),
                             LegSpec("cash", Decimal("-500"))], category="loan",
    )
    await borrow(user, "300", person="meera")
    people = await service.person_balances(user)
    meera = next(p for p in people if p["display_name"] == "Meera")
    assert Decimal(meera["balance"]) == Decimal("200")


async def test_concurrent_full_repayments_cannot_double_pay(user):
    """The same write-skew guard settle_up has, inherited rather than copied:
    ten commands to clear the whole debt, one repayment."""
    await borrow(user, "4000")
    results = await asyncio.gather(
        *(service.repay(user, "priya") for _ in range(10)), return_exceptions=True
    )
    committed = [r for r in results if not isinstance(r, Exception)]
    assert len(committed) == 1, f"{len(committed)} repayments committed, expected 1"

    balances = {b["name"]: Decimal(b["balance"]) for b in await service.account_balances(user)}
    assert balances.get("liability:priya", Decimal("0")) == 0
    assert sum(balances.values()) == 0
