from app.obs import middleware


def test_rate_limiter_allows_then_blocks(monkeypatch):
    monkeypatch.setattr(middleware, "_hits", {})
    key = ("203.0.113.7", "/chat")
    allowed = [not middleware._rate_limited(key) for _ in range(middleware.RATE_MAX_REQUESTS)]
    assert all(allowed)
    assert middleware._rate_limited(key) is True


def test_rate_limiter_is_per_caller(monkeypatch):
    monkeypatch.setattr(middleware, "_hits", {})
    for _ in range(middleware.RATE_MAX_REQUESTS):
        middleware._rate_limited(("203.0.113.7", "/chat"))
    assert middleware._rate_limited(("203.0.113.8", "/chat")) is False


def test_exhausting_one_endpoint_does_not_lock_the_others(monkeypatch):
    """A shared bucket meant 20 login attempts DoS'd chat for that caller."""
    monkeypatch.setattr(middleware, "_hits", {})
    caller = "203.0.113.9"
    for _ in range(middleware.RATE_MAX_REQUESTS):
        middleware._rate_limited((caller, "/auth/login"))
    assert middleware._rate_limited((caller, "/auth/login")) is True
    assert middleware._rate_limited((caller, "/chat")) is False


def test_expensive_get_endpoints_are_metered():
    assert "/analytics/export.csv" in middleware.METERED_PATHS
    assert "/insights/generate" in middleware.METERED_PATHS
