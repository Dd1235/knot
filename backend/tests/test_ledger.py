"""Ledger invariant tests. Run against the live dev cluster (DATABASE_URL).

Each test uses a unique throwaway user handle, so tests are isolated and
re-runnable without cleanup.
"""

import asyncio
import uuid
from decimal import Decimal

import pytest

from app.ledger import analytics, service
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


def test_money_can_come_from_an_account_other_than_cash():
    """Everything used to fund itself from `cash`, so a user with a salary
    account and a spending account could not say which one moved."""
    from app.agent.tools.ledger_tools import _build_legs

    legs = _build_legs("spent", Decimal("500"), "food", None, [], "hdfc")
    assert {leg.account for leg in legs} == {"expense:food", "hdfc"}
    assert sum(leg.amount for leg in legs) == 0

    # Default is unchanged for everyone who never names one.
    assert {leg.account for leg in _build_legs("spent", Decimal("500"), "food", None, [])} == {
        "expense:food",
        "cash",
    }


def test_money_cannot_be_funded_from_a_category():
    from app.agent.tools.ledger_tools import _build_legs

    with pytest.raises(UnbalancedTransaction):
        _build_legs("spent", Decimal("500"), "food", None, [], "expense:food")


async def test_a_transfer_between_own_accounts_is_not_spending(user):
    await service.post_transaction(
        user, "Opening", [LegSpec("hdfc", Decimal("50000")),
                          LegSpec("equity:opening", Decimal("-50000"))],
        category="opening_balance",
    )
    await service.post_transaction(
        user, "Moved to icici from hdfc",
        [LegSpec("icici", Decimal("20000")), LegSpec("hdfc", Decimal("-20000"))],
        category="transfer",
    )
    row = (await service.recent_transactions(user, limit=1))[0]
    assert row["direction"] == "transfer"
    summary = await analytics.summary(user, 30)
    assert Decimal(summary["total_spend"]) == 0


async def test_a_refund_reduces_the_original_category(user):
    """Posting it as income showed 500 spent and 200 earned. A refund is
    neither — it is 300 spent."""
    from app.agent.tools.ledger_tools import _build_legs

    await service.post_transaction(
        user, "dmart", _build_legs("spent", Decimal("500"), "groceries", None, []),
        category="groceries",
    )
    await service.post_transaction(
        user, "returned an item",
        _build_legs("refund", Decimal("200"), "groceries", None, []),
        category="groceries",
    )
    summary = await analytics.summary(user, 30)
    assert Decimal(summary["total_spend"]) == Decimal("300")
    assert Decimal(summary["total_income"]) == 0
    groceries = next(c for c in summary["by_category"] if c["category"] == "groceries")
    assert Decimal(groceries["amount"]) == Decimal("300")

    assert (await service.recent_transactions(user, limit=1))[0]["direction"] == "refund"
