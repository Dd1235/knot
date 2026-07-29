"""Analytics endpoints: spending summary and CSV export."""

import csv
import io

from fastapi import APIRouter, Header, Query
from fastapi.responses import StreamingResponse

from app.ledger import analytics

router = APIRouter(prefix="/analytics", tags=["analytics"])

CSV_COLUMNS = [
    "date", "description", "category", "group", "amount", "direction", "source", "voided",
]


def defuse_formula(value: str) -> str:
    """Neutralize spreadsheet formula injection: a cell starting with = + - @
    would execute as a formula in Excel/Sheets, so prefix it with a quote."""
    return f"'{value}" if value[:1] in ("=", "+", "-", "@") else value


@router.get("/summary")
async def summary(
    days: int = Query(default=30, ge=1, le=365),
    x_user: str = Header(default="demo"),
) -> dict:
    return await analytics.summary(x_user, days)


@router.get("/export.csv")
async def export_csv(
    days: int = Query(default=90, ge=1, le=365),
    x_user: str = Header(default="demo"),
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
        headers={"Content-Disposition": 'attachment; filename="ledger-export.csv"'},
    )
