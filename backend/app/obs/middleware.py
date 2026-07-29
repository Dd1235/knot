"""Request logging, passcode auth, and a small per-IP rate limit."""

import logging
import time

from fastapi import Request
from fastapi.responses import JSONResponse

log = logging.getLogger("ledger.request")

# Sliding-window rate limit for expensive endpoints (LLM-backed).
RATE_WINDOW_SECONDS = 60
RATE_MAX_REQUESTS = 20
# Per (caller, path) so exhausting one endpoint cannot lock a user out of the
# rest of the app.
_hits: dict[tuple[str, str], list[float]] = {}

# Expensive regardless of method — LLM calls, exports and the race demo.
METERED_PATHS = frozenset({
    "/chat", "/chat/stream", "/demo/race", "/insights/generate",
    "/auth/login", "/auth/signup", "/analytics/export.csv",
    "/voice/session",
})

OPEN_PATHS = {"/healthz"}


def _caller(request: Request) -> str:
    """Prefer the proxy-forwarded client over the socket peer: behind a load
    balancer every request otherwise shares the balancer's IP."""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _rate_limited(key: tuple[str, str]) -> bool:
    now = time.monotonic()
    # Evict windows that have fully aged out, so _hits cannot grow unbounded.
    for stale, times in list(_hits.items()):
        if not times or now - times[-1] > RATE_WINDOW_SECONDS * 10:
            del _hits[stale]
    hits = [t for t in _hits.get(key, []) if now - t < RATE_WINDOW_SECONDS]
    if len(hits) >= RATE_MAX_REQUESTS:
        _hits[key] = hits
        return True
    hits.append(now)
    _hits[key] = hits
    return False


async def guard(request: Request, call_next):
    start = time.perf_counter()
    path = request.url.path

    # Identity/authorization is enforced per-route by app.auth.deps.current_user;
    # this layer only rate-limits the expensive (LLM-backed) endpoints.
    if path in METERED_PATHS and request.method != "OPTIONS":
        if _rate_limited((_caller(request), path)):
            return JSONResponse({"detail": "rate limit exceeded"}, status_code=429)

    response = await call_next(request)
    log.info(
        "request",
        extra={
            "method": request.method,
            "path": path,
            "status": response.status_code,
            "duration_ms": int((time.perf_counter() - start) * 1000),
            "user": request.headers.get("x-user"),
        },
    )
    return response
