"""The race demo: N concurrent settlements of the same debt.

Under weak isolation this is textbook write skew — every request reads
"₹500 outstanding", validates, and writes, so the user gets "paid back"
N times. Under CockroachDB serializable isolation exactly one commits;
the rest retry, re-read a zero balance, and are cleanly rejected.
"""

import asyncio
import uuid
from decimal import Decimal

from fastapi import APIRouter
from pydantic import BaseModel, Field

import app.db.tx as tx
from app.ledger import service
from app.ledger.service import LegSpec, NothingOutstanding, OverSettlement

router = APIRouter(prefix="/demo", tags=["demo"])


class RaceIn(BaseModel):
    concurrency: int = Field(default=10, ge=2, le=25)
    amount: Decimal = Field(default=Decimal("500"))


@router.post("/race")
async def race(body: RaceIn) -> dict:
    user = f"race-{uuid.uuid4().hex[:10]}"
    await service.post_transaction(
        user,
        f"Lent Priya ₹{body.amount} for the demo",
        [LegSpec("receivable:priya", body.amount), LegSpec("cash", -body.amount)],
        category="loan",
        source="system",
    )

    retries_before = tx.retry_count
    results = await asyncio.gather(
        *[
            service.settle_up(user, "priya", body.amount, source="system")
            for _ in range(body.concurrency)
        ],
        return_exceptions=True,
    )
    retries = tx.retry_count - retries_before

    committed = sum(1 for r in results if isinstance(r, service.PostedTransaction))
    rejected = sum(1 for r in results if isinstance(r, NothingOutstanding | OverSettlement))
    errors = body.concurrency - committed - rejected

    return {
        "scenario": f"Priya owes ₹{body.amount}; {body.concurrency} settlements race",
        "attempts": body.concurrency,
        "committed": committed,
        "rejected": rejected,
        "errors": errors,
        "serialization_retries": retries,
        "priya_balance": next(
            (p["balance"] for p in await service.person_balances(user)), "0"
        ),
        "ledger_sum": str(await service.ledger_sum(user)),
        "demo_user": user,
    }
