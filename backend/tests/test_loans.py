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


async def test_an_emi_is_claimed_against_safe_to_spend(user):
    """An EMI is a commitment that happens to live in another table.

    It was missing from `upcoming()`, which meant three things at once: no EMI
    on the commitment calendar, none in "due next", and — the one that actually
    cost the user money — `claimed_before_income` never subtracted it, so
    safe-to-spend reported more available cash than existed.

    No salary here on purpose: with no next payday, everything upcoming is
    claimed, so the arithmetic is the same whatever today's date is. (With a
    payday, only commitments landing before it constrain today — an EMI due
    after the next salary correctly does not.)
    """
    from app.agent.tools.money_tools import set_opening_balance_for
    from app.ledger import analytics, recurring

    await set_opening_balance_for(user, Decimal("100000"), "bank")
    before = await analytics.safe_to_spend(user)

    await loans.add_loan(
        user, "car loan", Decimal("500000"), Decimal("9"), 60, due_day=5,
    )
    after = await analytics.safe_to_spend(user)
    emi = Decimal((await loans.list_loans(user))["loans"][0]["emi"])
    assert emi > 0

    ahead = await recurring.upcoming(user)
    car = [e for e in ahead["outgoing"] if e["name"] == "car loan"]
    assert car, f"the EMI never reached upcoming: {ahead['outgoing']}"
    assert car[0]["kind"] == "emi"
    assert Decimal(car[0]["amount"]) == emi

    # The money the EMI claims stops being offered as spendable. (Available
    # rises overall, because taking a loan also puts the principal in the bank —
    # what matters is that the EMI is now subtracted from it at all.)
    assert Decimal(after["claimed"]) == Decimal(before["claimed"]) + emi
    assert Decimal(after["available"]) == Decimal(after["liquid"]) - Decimal(after["claimed"])

    # And a subscription still reads as a subscription, not as debt — the
    # calendar draws them differently and needs to be able to tell.
    await recurring.upsert_commitment(user, "Netflix", Decimal("649"), due_day=5)
    again = await recurring.upcoming(user)
    assert next(e for e in again["outgoing"] if e["name"] == "Netflix")["kind"] == "recurring"


async def test_a_cleared_loan_stops_claiming_money(user):
    """Outstanding zero means the EMI is over; it must leave the calendar."""
    from app.ledger import recurring

    await loans.add_loan(
        user, "tiny loan", Decimal("1000"), Decimal("0"), 1, due_day=5,
    )
    assert any(e["kind"] == "emi" for e in (await recurring.upcoming(user))["outgoing"])

    # Pay it off entirely, so outstanding drops to zero.
    row = (await loans.list_loans(user))["loans"][0]
    await service.post_transaction(
        user,
        "clear the loan",
        [
            service.LegSpec(row["account_name"], Decimal(row["outstanding"])),
            service.LegSpec("cash", -Decimal(row["outstanding"])),
        ],
        category="loan",
    )
    assert not any(e["kind"] == "emi" for e in (await recurring.upcoming(user))["outgoing"])
