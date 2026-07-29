"""Analytics + recurring commitment tests. Run against the live dev cluster.

Each test uses a unique throwaway user handle, so tests are isolated and
re-runnable without cleanup.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

import httpx
import pytest

from app.agent.registry import ToolContext
from app.agent.tools import money_tools
from app.api.analytics import defuse_formula
from app.ledger import analytics, recurring, service
from app.ledger.service import LegSpec

IST = ZoneInfo("Asia/Kolkata")


@pytest.fixture
def user() -> str:
    return f"antest-{uuid.uuid4().hex[:12]}"


def spend(user: str, amount: str, category: str, description: str):
    return service.post_transaction(
        user,
        description,
        [LegSpec(f"expense:{category}", Decimal(amount)), LegSpec("cash", Decimal(amount) * -1)],
        category=category,
    )


async def test_summary_totals_groups_and_net_worth(user):
    await spend(user, "100", "food", "swiggy")
    await spend(user, "500", "rent", "july rent")
    await service.post_transaction(
        user,
        "salary",
        [LegSpec("cash", Decimal("1000")), LegSpec("income:salary", Decimal("-1000"))],
        category="salary",
    )
    await service.post_transaction(
        user,
        "lent arun 200",
        [LegSpec("receivable:arun", Decimal("200")), LegSpec("cash", Decimal("-200"))],
        category="loan",
    )

    result = await analytics.summary(user, 30)

    assert result["window_days"] == 30
    assert result["total_spend"] == "600.00"
    assert result["total_income"] == "1000.00"
    assert result["net_cashflow"] == "400.00"

    assert result["by_category"] == [
        {"category": "rent", "grp": "essentials", "amount": "500.00"},
        {"category": "food", "grp": "discretionary", "amount": "100.00"},
    ]
    groups = {g["grp"]: g for g in result["by_group"]}
    assert groups["essentials"]["amount"] == "500.00"
    assert groups["essentials"]["pct_of_spend"] == 83.3
    assert groups["discretionary"]["amount"] == "100.00"
    assert groups["discretionary"]["pct_of_spend"] == 16.7

    # cash: -100 -500 +1000 -200 = 200; receivable:arun = 200 -> assets 400.
    net_worth = result["net_worth"]
    assert net_worth["assets"] == "400.00"
    assert net_worth["liabilities"] == "0.00"
    assert net_worth["net_worth"] == "400.00"

    daily = result["daily"]
    assert len(daily) == 30
    assert daily[0]["date"] < daily[-1]["date"]  # oldest first
    assert daily[-1]["date"] == datetime.now(IST).date().isoformat()
    assert daily[-1]["spend"] == "600.00"
    assert daily[-1]["income"] == "1000.00"
    assert daily[0] == {
        "date": daily[0]["date"],
        "spend": "0.00",
        "invested": "0.00",
        "income": "0.00",
        "txns": 0,
    }


async def test_voided_transaction_nets_out_of_summary(user):
    posted = await spend(user, "100", "food", "disputed swiggy")
    await service.void_transaction(user, posted.id, "user disputed")

    result = await analytics.summary(user, 30)
    assert result["total_spend"] == "0.00"
    assert result["net_cashflow"] == "0.00"
    assert result["net_worth"]["net_worth"] == "0.00"


async def test_recurring_post_due_is_idempotent(user):
    await recurring.upsert_commitment(user, "Netflix", Decimal("649"))

    first = await recurring.post_due(user)
    assert first == ["Netflix"]
    second = await recurring.post_due(user)
    assert second == []

    txns = await service.recent_transactions(user)
    assert len(txns) == 1
    # The period is in the description so back-filled entries are distinguishable.
    assert txns[0]["description"].startswith("Netflix (auto")
    assert txns[0]["category"] == "subscriptions"
    assert txns[0]["source"] == "system"
    assert await service.ledger_sum(user) == 0

    listed = await recurring.list_commitments(user)
    assert listed["monthly_total"] == "649.00"
    assert listed["commitments"][0]["last_posted_period"] == datetime.now(IST).strftime("%Y-%m")


async def test_opening_balance_once_and_counted_in_net_worth(user):
    ctx = ToolContext(user_handle=user, session_id=f"sess-{uuid.uuid4().hex[:8]}")
    result = await money_tools.set_opening_balance(ctx, {"amount": 40000})
    accounts = {a["name"]: a for a in await service.account_balances(user)}
    assert accounts["cash"]["balance"] == "40000.00"
    assert accounts["equity:opening"]["type"] == "liability"
    assert "transaction_id" in result

    with pytest.raises(money_tools.OpeningBalanceExists, match="cash"):
        await money_tools.set_opening_balance(ctx, {"amount": 999})

    summary = await analytics.summary(user, 30)
    assert summary["net_worth"] == {
        "assets": "40000.00",
        "liabilities": "0.00",
        "net_worth": "40000.00",
    }


def test_defuse_formula_prefixes_dangerous_cells():
    assert defuse_formula("=SUM(A1)") == "'=SUM(A1)"
    assert defuse_formula("+91 999") == "'+91 999"
    assert defuse_formula("-42") == "'-42"
    assert defuse_formula("@import") == "'@import"
    assert defuse_formula("chai 15") == "chai 15"
    assert defuse_formula("") == ""


async def test_csv_export_escapes_formula_cells(user):
    from app.main import app

    await spend(user, "55", "food", "=SUM(A1) totally normal chai")

    # auth_required is off in dev/test, so the X-User header identifies the caller.
    headers = {"X-User": user}
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/analytics/export.csv", params={"days": 7}, headers=headers)

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/csv")
    assert "attachment" in resp.headers["content-disposition"]
    lines = resp.text.strip().splitlines()
    assert lines[0] == "date,description,category,group,amount,direction,source,voided"
    assert "'=SUM(A1) totally normal chai" in resp.text
    row = lines[1].split(",")
    assert row[1] == "'=SUM(A1) totally normal chai"
    assert row[2:] == ["food", "discretionary", "55.00", "spent", "text", "false"]


def test_monthly_due_day_clamps_to_short_months():
    """A commitment due on the 31st must still post in 30-day months."""
    from datetime import date, datetime

    from app.ledger.recurring import _current_period

    created = datetime(2026, 1, 15, tzinfo=IST)
    assert _current_period("monthly", 31, created, date(2026, 4, 30)) == "2026-04"
    assert _current_period("monthly", 31, created, date(2026, 2, 28)) == "2026-02"
    assert _current_period("monthly", 31, created, date(2026, 4, 29)) is None
    assert _current_period("monthly", 1, created, date(2026, 4, 1)) == "2026-04"


async def test_daily_spine_sums_to_headline_totals(user):
    """Calendar-aligned windows keep the chart and the headline consistent."""
    from decimal import Decimal

    from app.ledger import analytics
    from app.ledger.service import LegSpec, post_transaction

    await post_transaction(
        user,
        "groceries",
        [LegSpec("expense:groceries", Decimal("300")), LegSpec("cash", Decimal("-300"))],
        category="groceries",
    )
    result = await analytics.summary(user, 30)
    assert sum(Decimal(d["spend"]) for d in result["daily"]) == Decimal(result["total_spend"])
    assert sum(Decimal(d["income"]) for d in result["daily"]) == Decimal(result["total_income"])


async def test_void_nets_out_of_the_original_window_not_today(user):
    """A reversal must inherit the original's date, or windowed aggregates
    show negative spend in the current period."""
    from datetime import datetime, timedelta

    old = datetime.now(IST) - timedelta(days=40)
    posted = await service.post_transaction(
        user,
        "old rent",
        [LegSpec("expense:rent", Decimal("5000")), LegSpec("cash", Decimal("-5000"))],
        category="rent",
        occurred_at=old,
    )
    await service.void_transaction(user, posted.id, "user disputed")

    recent = await analytics.summary(user, 7)
    assert recent["total_spend"] == "0.00"
    assert recent["net_cashflow"] == "0.00"
    assert all(Decimal(d["spend"]) >= 0 for d in recent["daily"])


async def test_void_cancels_the_original_category_row(user):
    """The reversal keeps the original category, so by_category nets to zero
    instead of leaving a phantom 'reversal' bucket."""
    posted = await spend(user, "100", "food", "disputed swiggy")
    await service.void_transaction(user, posted.id, "disputed")

    result = await analytics.summary(user, 30)
    assert result["by_category"] == []
    assert result["by_group"] == []


async def test_idempotency_keys_are_scoped_per_user(user):
    """A client-chosen key must not return another user's transaction."""
    other = f"antest-{uuid.uuid4().hex[:12]}"
    key = "shared-key-2026-07-29"

    mine = await service.post_transaction(
        user,
        "my chai",
        [LegSpec("expense:food", Decimal("15")), LegSpec("cash", Decimal("-15"))],
        category="food",
        idempotency_key=key,
    )
    theirs = await service.post_transaction(
        other,
        "their rent",
        [LegSpec("expense:rent", Decimal("30000")), LegSpec("cash", Decimal("-30000"))],
        category="rent",
        idempotency_key=key,
    )
    assert not theirs.deduplicated
    assert theirs.id != mine.id
    assert (await analytics.summary(other, 30))["total_spend"] == "30000.00"


async def test_settlement_rejects_zero_and_negative_amounts(user):
    await service.post_transaction(
        user,
        "lent priya",
        [LegSpec("receivable:priya", Decimal("500")), LegSpec("cash", Decimal("-500"))],
        category="loan",
    )
    for bad in (Decimal("0"), Decimal("-100")):
        with pytest.raises(service.LedgerError, match="positive"):
            await service.settle_up(user, "priya", bad)
    assert (await service.person_balances(user))[0]["balance"] == "500.00"


def test_defuse_formula_covers_whitespace_prefixed_payloads():
    assert defuse_formula("\t=cmd|' /c calc'!A1").startswith("'")
    assert defuse_formula("\r=1+1").startswith("'")
    assert defuse_formula(" =HYPERLINK()").startswith("'")
    assert defuse_formula("\n@SUM(1)").startswith("'")
    assert defuse_formula("normal text") == "normal text"


async def test_naive_occurred_at_is_treated_as_local_time(user):
    """The prompt tells the model it is in IST, so naive datetimes it emits
    must not be read as UTC — an evening entry would land on the next day."""
    from app.agent.tools.ledger_tools import _parse_occurred_at

    parsed = _parse_occurred_at("2026-07-29T21:30:00")
    assert parsed is not None and parsed.tzinfo is not None
    assert parsed.utcoffset().total_seconds() == 5.5 * 3600


def test_recurring_backfills_missed_periods():
    """A user who doesn't open the app for months must not lose those postings."""
    from datetime import date, datetime

    from app.ledger.recurring import _periods_due

    created = datetime(2026, 1, 10, tzinfo=IST)
    # Last posted in May, now July -> June and July are both owed.
    assert _periods_due("monthly", 1, created, date(2026, 7, 15), "2026-05") == [
        "2026-06",
        "2026-07",
    ]
    # Already current: nothing owed.
    assert _periods_due("monthly", 1, created, date(2026, 7, 15), "2026-07") == []
    # Year rollover.
    assert _periods_due("monthly", 1, created, date(2026, 2, 5), "2025-12") == [
        "2026-01",
        "2026-02",
    ]
    # A long-dormant account is capped rather than posting dozens at once.
    assert len(_periods_due("monthly", 1, created, date(2026, 7, 15), "2020-01")) == 12
    # First run only posts the current period, not all of history.
    assert _periods_due("monthly", 1, created, date(2026, 7, 15), "") == ["2026-07"]


def test_backfilled_entries_are_dated_to_their_own_period():
    """Otherwise a catch-up would dump months of spend onto today's chart."""
    from app.ledger.recurring import _period_start

    assert _period_start("monthly", "2026-06", 1).date().isoformat() == "2026-06-01"
    # Due-day clamps to short months.
    assert _period_start("monthly", "2026-02", 31).date().isoformat() == "2026-02-28"


async def test_rhythm_ranks_merchants_by_count_not_amount(user):
    """76% of UPI transactions are under ₹500 — ranking by rupees would hide
    the user's actual daily life, so this module counts."""
    for _ in range(5):
        await spend(user, "40", "food", "chai")
    await spend(user, "6000", "rent", "july rent")

    result = await analytics.rhythm(user, 30)
    assert result["top_merchants"][0]["merchant"] == "chai"
    assert result["top_merchants"][0]["times"] == 5
    assert result["top_merchants"][1]["merchant"] == "july rent"
    assert result["transactions"] == 6
    assert result["per_active_day"] == 6.0


async def test_safe_to_spend_sets_aside_only_what_is_due_before_payday(user):
    """A commitment after the next salary does not constrain today."""
    from app.agent.registry import ToolContext
    from app.agent.tools import money_tools

    ctx = ToolContext(user_handle=user, session_id=f"s-{uuid.uuid4().hex[:8]}")
    await money_tools.set_opening_balance(ctx, {"amount": 50000, "account": "bank"})
    # Salary on the 1st, rent on the 5th: rent lands after the next payday.
    await recurring.upsert_commitment(
        user, "salary", Decimal("60000"), due_day=1, direction="received", category="salary"
    )
    await recurring.upsert_commitment(user, "rent", Decimal("12000"), due_day=5)

    result = await analytics.safe_to_spend(user)
    assert result["liquid"] == "50000.00"
    assert result["next_income"]["name"] == "salary"
    # Whatever is claimed must never exceed the commitments themselves.
    assert Decimal(result["claimed"]) <= Decimal("12000")
    assert Decimal(result["available"]) == Decimal(result["liquid"]) - Decimal(result["claimed"])


async def test_cash_float_counts_only_bank_to_cash_transfers(user):
    """Income credited to cash is not cash-in-hand; counting it would make
    the unaccounted figure meaningless."""
    from app.agent.registry import ToolContext
    from app.agent.tools import money_tools

    ctx = ToolContext(user_handle=user, session_id=f"s-{uuid.uuid4().hex[:8]}")
    await money_tools.set_opening_balance(ctx, {"amount": 50000, "account": "bank"})
    # Salary paid into cash — NOT a withdrawal.
    await service.post_transaction(
        user,
        "salary",
        [LegSpec("cash", Decimal("60000")), LegSpec("income:salary", Decimal("-60000"))],
        category="salary",
    )
    assert (await analytics.cash_float(user))["withdrawn"] == "0.00"

    await money_tools.withdraw_cash(ctx, {"amount": 5000})
    after = await analytics.cash_float(user)
    assert after["withdrawn"] == "5000.00"

    await money_tools.log_cash_spend(
        ctx, {"amount": 1200, "description": "vegetables", "category": "groceries"}
    )
    closed = await analytics.cash_float(user)
    assert closed["accounted"] == "1200.00"
    assert closed["unaccounted"] == "3800.00"
