from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from app.ledger import recurring, service
from app.ledger.service import (
    LegSpec,
    NothingOutstanding,
    OverSettlement,
    UnbalancedTransaction,
)

router = APIRouter(prefix="/ledger", tags=["ledger"])


class LegIn(BaseModel):
    account: str
    amount: Decimal
    memo: str = ""


class TransactionIn(BaseModel):
    description: str
    legs: list[LegIn] = Field(min_length=2)
    category: str = "uncategorized"
    raw_input: str = ""
    occurred_at: datetime | None = None
    idempotency_key: str | None = None


class SettleIn(BaseModel):
    person: str
    amount: Decimal | None = None
    idempotency_key: str | None = None


def _txn_response(posted: service.PostedTransaction) -> dict:
    return {
        "id": str(posted.id),
        "description": posted.description,
        "category": posted.category,
        "legs": posted.legs,
        "deduplicated": posted.deduplicated,
    }


@router.post("/transactions", status_code=201)
async def create_transaction(
    body: TransactionIn, x_user: str = Header(default="demo")
) -> dict:
    try:
        posted = await service.post_transaction(
            x_user,
            body.description,
            [LegSpec(leg.account, leg.amount, leg.memo) for leg in body.legs],
            raw_input=body.raw_input,
            category=body.category,
            occurred_at=body.occurred_at,
            idempotency_key=body.idempotency_key,
        )
    except UnbalancedTransaction as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _txn_response(posted)


@router.post("/settle", status_code=201)
async def settle(body: SettleIn, x_user: str = Header(default="demo")) -> dict:
    try:
        posted = await service.settle_up(
            x_user, body.person, body.amount, idempotency_key=body.idempotency_key
        )
    except (NothingOutstanding, OverSettlement) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _txn_response(posted)


class VoidIn(BaseModel):
    reason: str = ""


@router.post("/transactions/{transaction_id}/void", status_code=201)
async def void_transaction(
    transaction_id: str, body: VoidIn, x_user: str = Header(default="demo")
) -> dict:
    try:
        posted = await service.void_transaction(x_user, transaction_id, body.reason)
    except service.LedgerError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _txn_response(posted)


@router.get("/balances")
async def balances(x_user: str = Header(default="demo")) -> dict:
    return {
        "accounts": await service.account_balances(x_user),
        "people": await service.person_balances(x_user),
        "ledger_sum": str(await service.ledger_sum(x_user)),
    }


@router.get("/transactions")
async def list_transactions(
    limit: int = 20, x_user: str = Header(default="demo")
) -> dict:
    return {"transactions": await service.recent_transactions(x_user, limit)}


@router.get("/recurring")
async def list_recurring(x_user: str = Header(default="demo")) -> dict:
    return await recurring.list_commitments(x_user)
