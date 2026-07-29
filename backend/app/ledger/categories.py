"""The category taxonomy, and the one distinction that changes the accounting.

Money put into a SIP, FD or stocks has not left the user's net worth — it has
changed shape. Booking it to `expense:sip` would be wrong twice over: net worth
would fall every time they did the right thing, and every "you spent" total on
the dashboard would be inflated by their savings.

So investment categories route to an `invest:` asset account instead. The
`invest:` prefix falls through `service._account_type` to 'asset', which is
exactly what it is.

This set must stay in step with the `savings_invest` rows in
migration 0004 — `tests/test_categories.py` asserts it against the database.
"""

INVESTMENT_CATEGORIES = frozenset(
    {
        "sip",
        "mutual_funds",
        "stocks",
        "fd",
        "rd",
        "savings",
        "nps",
        "ppf",
        "elss",
        "gold",
        "crypto",
        "bonds",
    }
)

INVEST_PREFIX = "invest:"


def is_investment(category: str) -> bool:
    return (category or "").strip().lower() in INVESTMENT_CATEGORIES


def account_for(category: str) -> str:
    """Where the debit leg of a 'spent' transaction should land."""
    category = (category or "general").strip().lower()
    if is_investment(category):
        return f"{INVEST_PREFIX}{category}"
    return f"expense:{category}"
