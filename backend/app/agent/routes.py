"""Where the user is standing, in words the model can use.

Not a screen scrape — the model gets the page's *identity*, then calls the
matching report tool for the numbers, so a spoken answer still comes from SQL.
Without this, "what's on this page?" got "which page?" and a self-correction.
"""

ROUTES: dict[str, str] = {
    "/app": "Chat — the conversation with you",
    "/insights": (
        "Insights — safe-to-spend, the spending heatmap, daily spend, "
        "spending groups, top categories, monthly limits, what you noticed"
    ),
    "/transactions": "Ledger — every transaction, newest first, searchable",
    "/investments": "Investments — holdings, units, cost, market value, gains",
    "/debts": "Debt — loans with their EMI principal/interest split, and who owes whom",
    "/memory": "Memory — the four stores: facts, events, rules, and tool calls",
    "/sessions": "History — past conversations",
    "/architecture": "How it works — the architecture, read live from the database",
    "/demo": "Race demo — concurrent settlements against the serializable ledger",
}


def describe(route: str | None) -> str:
    """One instruction line, or nothing when the route is unknown."""
    if not route:
        return ""
    page = ROUTES.get(route.rstrip("/") or "/app")
    if not page:
        return ""
    return (
        f"\n\nThe user is currently looking at: {page}. "
        'If they say "this page", "here", or "what am I looking at", that is what '
        "they mean — answer about it, using the matching tool for any figures."
    )
