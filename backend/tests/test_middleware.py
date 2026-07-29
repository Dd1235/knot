from app.obs import middleware


def test_rate_limiter_allows_then_blocks(monkeypatch):
    monkeypatch.setattr(middleware, "_hits", {})
    ip = "203.0.113.7"
    allowed = [not middleware._rate_limited(ip) for _ in range(middleware.RATE_MAX_REQUESTS)]
    assert all(allowed)
    assert middleware._rate_limited(ip) is True


def test_rate_limiter_is_per_ip(monkeypatch):
    monkeypatch.setattr(middleware, "_hits", {})
    for _ in range(middleware.RATE_MAX_REQUESTS):
        middleware._rate_limited("203.0.113.7")
    assert middleware._rate_limited("203.0.113.8") is False
