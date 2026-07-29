"""Request logging, passcode auth, and a small per-IP rate limit."""

import logging
import time

from fastapi import Request
from fastapi.responses import JSONResponse

from app.config import get_settings

log = logging.getLogger("ledger.request")

# Sliding-window rate limit for expensive endpoints (LLM-backed).
RATE_WINDOW_SECONDS = 60
RATE_MAX_REQUESTS = 20
_hits: dict[str, list[float]] = {}

OPEN_PATHS = {"/healthz"}


def _rate_limited(ip: str) -> bool:
    now = time.monotonic()
    hits = [t for t in _hits.get(ip, []) if now - t < RATE_WINDOW_SECONDS]
    if len(hits) >= RATE_MAX_REQUESTS:
        _hits[ip] = hits
        return True
    hits.append(now)
    _hits[ip] = hits
    return False


async def guard(request: Request, call_next):
    start = time.perf_counter()
    path = request.url.path

    if path not in OPEN_PATHS and request.method != "OPTIONS":
        passcode = get_settings().app_passcode
        if passcode:
            supplied = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
            if supplied != passcode:
                return JSONResponse({"detail": "passcode required"}, status_code=401)

        if request.method == "POST" and path in ("/chat", "/demo/race"):
            ip = request.client.host if request.client else "unknown"
            if _rate_limited(ip):
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
