from psycopg_pool import AsyncConnectionPool

from app.config import get_settings

_pool: AsyncConnectionPool | None = None


async def open_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(
            get_settings().database_url,
            min_size=1,
            max_size=10,
            open=False,
            # The cluster is a managed one in another region, and it drops
            # connections that have been idle a while. Without a liveness check
            # the pool hands out a dead socket and the request fails with an
            # SSL syscall timeout — the user sees a 500 for no reason of theirs,
            # and only the *next* request succeeds. check_connection replaces a
            # dead connection before it is handed out.
            check=AsyncConnectionPool.check_connection,
            # Recycle well inside typical idle timeouts rather than waiting to
            # discover the hard way.
            max_idle=300,
            max_lifetime=1800,
            reconnect_timeout=30,
        )
        await _pool.open(wait=True, timeout=30)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> AsyncConnectionPool:
    if _pool is None:
        raise RuntimeError("DB pool is not open; call open_pool() first")
    return _pool
