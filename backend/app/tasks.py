"""Fire-and-forget background tasks (memory writes must never block replies)."""

import asyncio
import logging
from collections.abc import Coroutine

log = logging.getLogger(__name__)

_running: set[asyncio.Task] = set()


def fire_and_forget(coro: Coroutine, label: str = "task") -> None:
    task = asyncio.create_task(coro)
    _running.add(task)

    def _done(t: asyncio.Task) -> None:
        _running.discard(t)
        if not t.cancelled() and t.exception():
            log.error("background %s failed", label, exc_info=t.exception())

    task.add_done_callback(_done)
