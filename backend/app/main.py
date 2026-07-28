import time
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.db.pool import close_pool, open_pool, pool


@asynccontextmanager
async def lifespan(_: FastAPI):
    await open_pool()
    yield
    await close_pool()


app = FastAPI(title="Ledger", lifespan=lifespan)


@app.get("/healthz")
async def healthz() -> dict:
    start = time.perf_counter()
    async with pool().connection() as conn:
        cur = await conn.execute("SELECT version()")
        row = await cur.fetchone()
    return {
        "status": "ok",
        "db_roundtrip_ms": round((time.perf_counter() - start) * 1000, 1),
        "db_version": row[0].split("(")[0].strip(),
    }
