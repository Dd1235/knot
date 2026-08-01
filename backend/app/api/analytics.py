"""Analytics endpoints: spending summary and CSV export."""

import csv
import io

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.auth.deps import current_user
from app.ledger import analytics, limits, recurring

router = APIRouter(prefix="/analytics", tags=["analytics"])

CSV_COLUMNS = [
    "date", "description", "category", "group", "amount", "direction", "source", "voided",
]


# Excel/Sheets also treat tab and CR as cell-starting characters, and strip
# leading whitespace before evaluating — so "\t=cmd|..." executes unless the
# value is stripped BEFORE the test.
DANGEROUS_PREFIXES = ("=", "+", "-", "@", "\t", "\r", "\n")


def defuse_formula(value: str) -> str:
    """Neutralize spreadsheet formula injection by quoting the cell."""
    stripped = value.lstrip(" \t\r\n")
    if value[:1] in DANGEROUS_PREFIXES or stripped[:1] in DANGEROUS_PREFIXES:
        return f"'{value}"
    return value


@router.get("/summary")
async def summary(
    days: int = Query(default=30, ge=1, le=365),
    offset_days: int = Query(default=0, ge=0, le=365),
    x_user: str = Depends(current_user),
) -> dict:
    return await analytics.summary(x_user, days, offset_days)


@router.get("/rhythm")
async def rhythm(
    days: int = Query(default=30, ge=1, le=365),
    x_user: str = Depends(current_user),
) -> dict:
    return await analytics.rhythm(x_user, days)


@router.get("/safe-to-spend")
async def safe_to_spend(x_user: str = Depends(current_user)) -> dict:
    return await analytics.safe_to_spend(x_user)


@router.get("/upcoming")
async def upcoming(
    horizon_days: int = Query(default=45, ge=1, le=365),
    x_user: str = Depends(current_user),
) -> dict:
    """What is due, in and out, over the horizon."""
    return await recurring.upcoming(x_user, horizon_days=horizon_days)


@router.get("/limits")
async def spend_limits(x_user: str = Depends(current_user)) -> dict:
    return await limits.status(x_user)


@router.get("/cash")
async def cash(x_user: str = Depends(current_user)) -> dict:
    return await analytics.cash_float(x_user)


@router.get("/export.csv")
async def export_csv(
    days: int = Query(default=90, ge=1, le=365),
    x_user: str = Depends(current_user),
) -> StreamingResponse:
    rows = await analytics.export_rows(x_user, days)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(CSV_COLUMNS)
    for row in rows:
        values = [
            row["txn_date"],
            row["description"],
            row["category"],
            row["grp"],
            row["amount"],
            row["direction"],
            row["source"],
            "true" if row["voided"] else "false",
        ]
        writer.writerow([defuse_formula(str(v)) for v in values])
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="knot-export.csv"'},
    )
