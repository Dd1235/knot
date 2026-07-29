"""One database pool for the whole test session.

Each test module used to declare its own session-scoped `_pool` fixture. That
looks harmless but isn't: a module-level fixture is scoped to its module, so
the pool got opened and closed repeatedly, and a single stray `close_pool()`
in one file left every later file connectionless. One fixture, defined once.
"""

import pytest

from app.db.pool import close_pool, open_pool


@pytest.fixture(scope="session", autouse=True)
async def _pool():
    await open_pool()
    yield
    await close_pool()
