"""An EMI is mostly not spending, and the schedule is derived, not stored."""

import uuid
from datetime import date
from decimal import Decimal

import pytest

from app.ledger import loans, service


@pytest.fixture
def user() -> str:
    return f"loan-{uuid.uuid4().hex[:12]}"


def test_emi_formula_matches_the_standard_reducing_balance():
    # 10,00,000 at 9% over 120 months is a widely published 12,667.58.
    assert loans.emi_for(Decimal("1000000"), Decimal("9"), 120) == Decimal("12667.58")


def test_interest_free_loan_divides_evenly():
    assert loans.emi_for(Decimal("12000"), Decimal("0"), 12) == Decimal("1000.00")


def test_most_of_an_early_emi_is_interest_not_principal():
    """The whole point: booking the full payment as spending overstates spend
    by the principal share."""
    principal, interest = loans.split_payment(
        Decimal("1000000"), Decimal("12667.58"), Decimal("9")
    )
    assert interest == Decimal("7500.00")
    assert principal == Decimal("5167.58")
    assert principal + interest == Decimal("12667.58")


def test_the_final_payment_lands_exactly_on_zero():
    """Without the min() the last EMI overshoots into a negative balance."""
    outstanding = Decimal("500.00")
    principal, interest = loans.split_payment(outstanding, Decimal("12667.58"), Decimal("9"))
    assert principal == outstanding
    assert outstanding - principal == 0


def test_payoff_is_derived_from_the_balance():
    assert loans.months_remaining(Decimal("0"), Decimal("5000"), Decimal("9")) == 0
    # A payment that cannot outrun the interest never pays off.
    assert loans.months_remaining(Decimal("1000000"), Decimal("100"), Decimal("9")) is None
    assert loans.months_remaining(Decimal("1000000"), Decimal("12667.58"), Decimal("9")) == 120


def test_loan_account_never_becomes_a_person():
    """liability:priya is someone you owe; liability:loan:* is a bank."""
    from app.ledger.service import _account_type, _is_person_account

    name = loans.account_for("Home Loan")
    assert name == "liability:loan:home_loan"
    assert not _is_person_account(name, _account_type(name))


@pytest.mark.asyncio
async def test_emi_reduces_debt_and_only_interest_counts_as_spend(user):
    await loans.add_loan(
        user, "Bike Loan", Decimal("100000"), Decimal("12"), 24, emi=Decimal("4707.35"),
        due_day=5,
    )
    before = await loans.outstanding_for(user, loans.account_for("Bike Loan"))
    assert before == Decimal("100000")

    # Pinned: with a due_day of 5, this test passed or failed depending on
    # what day of the month it ran.
    posted = await loans.post_due(user, today=date(date.today().year, date.today().month, 20))
    assert posted, "an EMI should have been due"
    first = posted[0]
    assert Decimal(first["interest"]) == Decimal("1000.00")   # 100000 * 12%/12
    assert Decimal(first["principal"]) == Decimal("3707.35")

    after = await loans.outstanding_for(user, loans.account_for("Bike Loan"))
    assert after == Decimal("100000") - Decimal(first["principal"])

    # Only the interest is spending. Asserted against the accounts rather than
    # a windowed summary: the entry is dated to its due day, which may be in
    # the future, and that has nothing to do with the claim being tested.
    balances = {b["name"]: Decimal(b["balance"]) for b in await service.account_balances(user)}
    assert balances["expense:interest"] == Decimal("1000.00")
    assert "expense:emi" not in balances, "the principal must never be an expense"


@pytest.mark.asyncio
async def test_posting_twice_does_not_pay_twice(user):
    await loans.add_loan(
        user, "Car Loan", Decimal("50000"), Decimal("10"), 12, emi=Decimal("4395.79")
    )
    on = date(date.today().year, date.today().month, 20)
    await loans.post_due(user, today=on)
    outstanding = await loans.outstanding_for(user, loans.account_for("Car Loan"))
    await loans.post_due(user, today=on)
    assert await loans.outstanding_for(user, loans.account_for("Car Loan")) == outstanding
