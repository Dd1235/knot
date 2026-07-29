import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.analytics import router as analytics_router
from app.api.auth import router as auth_router
from app.api.chat import router as chat_router
from app.api.demo import router as demo_router
from app.api.ledger import router as ledger_router
from app.api.memory import router as memory_router
from app.config import get_settings
from app.db.pool import close_pool, open_pool, pool
from app.obs.logging import configure_logging
from app.obs.middleware import guard

configure_logging()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await open_pool()
    yield
    await close_pool()


app = FastAPI(title="Ledger", lifespan=lifespan)
app.middleware("http")(guard)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins.split(","),
    allow_credentials=True,  # session cookie
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(ledger_router)
app.include_router(analytics_router)
app.include_router(chat_router)
app.include_router(memory_router)
app.include_router(demo_router)


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
