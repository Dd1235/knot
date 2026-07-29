"""Ledger invariant tests. Run against the live dev cluster (DATABASE_URL).

Each test uses a unique throwaway user handle, so tests are isolated and
re-runnable without cleanup.
"""

import asyncio
import uuid
from decimal import Decimal

import pytest

from app.ledger import service
from app.ledger.service import (
    LegSpec,
    NothingOutstanding,
    OverSettlement,
    UnbalancedTransaction,
)


@pytest.fixture
def user() -> str:
    return f"test-{uuid.uuid4().hex[:12]}"


def lend_priya_500(user: str):
    return service.post_transaction(
        user,
        "Lent Priya ₹500 for lunch",
        [
            LegSpec("receivable:priya", Decimal("500")),
            LegSpec("cash", Decimal("-500")),
        ],
        category="loan",
    )


async def test_balanced_transaction_posts_and_balances_derive(user):
    posted = await lend_priya_500(user)
    assert len(posted.legs) == 2

    people = await service.person_balances(user)
    assert people == [{"display_name": "Priya", "balance": "500.00"}]

    accounts = {a["name"]: a["balance"] for a in await service.account_balances(user)}
    assert accounts["cash"] == "-500.00"
    assert accounts["receivable:priya"] == "500.00"
    assert await service.ledger_sum(user) == 0


async def test_unbalanced_transaction_rejected(user):
    with pytest.raises(UnbalancedTransaction):
        await service.post_transaction(
            user,
            "broken",
            [LegSpec("expense:food", Decimal("100")), LegSpec("cash", Decimal("-90"))],
        )
    assert await service.recent_transactions(user) == []


async def test_settle_full_amount(user):
    await lend_priya_500(user)
    posted = await service.settle_up(user, "Priya")
    assert posted.category == "settlement"

    people = await service.person_balances(user)
    assert people[0]["balance"] == "0.00"
    assert await service.ledger_sum(user) == 0


async def test_partial_settlement(user):
    await lend_priya_500(user)
    await service.settle_up(user, "priya", Decimal("200"))
    people = await service.person_balances(user)
    assert people[0]["balance"] == "300.00"


async def test_over_settlement_rejected(user):
    await lend_priya_500(user)
    with pytest.raises(OverSettlement):
        await service.settle_up(user, "priya", Decimal("600"))


async def test_settle_with_nothing_outstanding_rejected(user):
    with pytest.raises(NothingOutstanding):
        await service.settle_up(user, "priya")


async def test_idempotency_key_dedupes(user):
    key = f"idem-{uuid.uuid4().hex}"
    first = await service.post_transaction(
        user,
        "chai ₹15",
        [LegSpec("expense:food", Decimal("15")), LegSpec("cash", Decimal("-15"))],
        idempotency_key=key,
    )
    second = await service.post_transaction(
        user,
        "chai ₹15 (retry)",
        [LegSpec("expense:food", Decimal("15")), LegSpec("cash", Decimal("-15"))],
        idempotency_key=key,
    )
    assert second.deduplicated
    assert second.id == first.id
    assert len(await service.recent_transactions(user)) == 1


async def test_concurrent_settlement_race_keeps_ledger_balanced(user):
    """The demo scenario: Priya owes 500 and five full settlements race.

    Exactly one must commit; the rest must be cleanly rejected after
    CockroachDB serializes them; the ledger must remain exactly zero-sum.
    """
    await lend_priya_500(user)

    results = await asyncio.gather(
        *[service.settle_up(user, "priya", Decimal("500")) for _ in range(5)],
        return_exceptions=True,
    )

    successes = [r for r in results if isinstance(r, service.PostedTransaction)]
    rejections = [r for r in results if isinstance(r, NothingOutstanding | OverSettlement)]
    assert len(successes) == 1, f"expected exactly 1 commit, got {len(successes)}"
    assert len(rejections) == 4
    assert (await service.person_balances(user))[0]["balance"] == "0.00"
    assert await service.ledger_sum(user) == 0


async def test_borrowing_does_not_render_as_spending(user):
    """The direction CASE fell through to 'spent' for anything it did not
    recognise, so "borrowed 5,000 from Priya" displayed as money going out."""
    await service.post_transaction(
        user, "borrowed from Priya",
        [LegSpec("cash", Decimal("5000")), LegSpec("liability:priya", Decimal("-5000"))],
        category="loan",
    )
    row = (await service.recent_transactions(user, limit=1))[0]
    assert row["direction"] == "borrowed"


async def test_withdrawing_cash_is_a_move_not_a_spend(user):
    await service.post_transaction(
        user, "ATM", [LegSpec("cash", Decimal("2000")), LegSpec("bank", Decimal("-2000"))],
        category="withdrawal",
    )
    assert (await service.recent_transactions(user, limit=1))[0]["direction"] == "transfer"


async def test_a_sip_reads_as_invested(user):
    await service.post_transaction(
        user, "Monthly SIP",
        [LegSpec("invest:sip", Decimal("5000")), LegSpec("bank", Decimal("-5000"))],
        category="sip",
    )
    assert (await service.recent_transactions(user, limit=1))[0]["direction"] == "invested"


async def test_one_utterance_is_one_transaction(user):
    """Two clients transcribing the same sentence must not post it twice."""
    key = "same-utterance-key"
    legs = [LegSpec("expense:food", Decimal("120")), LegSpec("cash", Decimal("-120"))]
    first = await service.post_transaction(
        user, "chai", legs, category="food", idempotency_key=key
    )
    second = await service.post_transaction(
        user, "chai", legs, category="food", idempotency_key=key
    )
    assert second.deduplicated
    assert second.id == first.id
    assert len(await service.recent_transactions(user, limit=10)) == 1
