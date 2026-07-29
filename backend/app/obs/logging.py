"""JSON structured logging to stdout — CloudWatch-friendly, zero dependencies."""

import json
import logging
import sys
from datetime import UTC, datetime


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0]:
            entry["exc"] = self.formatException(record.exc_info)
        for key in (
            "method", "path", "status", "duration_ms", "user",
            "session_id", "tool", "iteration", "assembly_ms", "llm_ms",
        ):
            value = getattr(record, key, None)
            if value is not None:
                entry[key] = value
        return json.dumps(entry, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # uvicorn's access log is replaced by our request middleware.
    logging.getLogger("uvicorn.access").disabled = True
