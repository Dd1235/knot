"""Serializable transaction runner with automatic retry.

CockroachDB runs SERIALIZABLE by default and surfaces contention as error
40001 (serialization_failure), which clients are expected to retry. Every
mutating ledger/memory operation goes through run_serializable() so retry
handling lives in exactly one place and is observable.
"""

import asyncio
import logging
import random
from collections.abc import Awaitable, Callable

import psycopg
from psycopg import AsyncConnection

from app.db.pool import pool

log = logging.getLogger(__name__)

MAX_RETRIES = 8

# Cumulative 40001 retries since process start; surfaced by the race demo
# and (later) exported as a metric.
retry_count: int = 0


class SerializationExhausted(Exception):
    """A transaction kept colliding after MAX_RETRIES attempts."""


async def run_serializable[T](fn: Callable[[AsyncConnection], Awaitable[T]]) -> T:
    """Run fn(conn) inside a SERIALIZABLE transaction, retrying on 40001.

    fn must be safe to re-execute from scratch (it will re-read state each
    attempt — that re-read is exactly what makes the retry correct).
    """
    global retry_count
    for attempt in range(MAX_RETRIES + 1):
        try:
            async with pool().connection() as conn:
                async with conn.transaction():
                    await conn.execute("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
                    return await fn(conn)
        except psycopg.errors.SerializationFailure:
            retry_count += 1
            if attempt == MAX_RETRIES:
                raise SerializationExhausted(
                    f"gave up after {MAX_RETRIES} serialization retries"
                ) from None
            backoff = min(0.05 * (2**attempt), 1.0) * (0.5 + random.random())
            log.info(
                "40001 serialization retry #%d, backing off %.0fms", attempt + 1, backoff * 1000
            )
            await asyncio.sleep(backoff)
    raise AssertionError("unreachable")
