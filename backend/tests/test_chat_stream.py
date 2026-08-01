"""A failure mid-turn has to reach the user.

The stream sends its 200 and headers before the turn runs, so an exception
afterwards could only truncate the body. The client saw a clean end, showed no
reply and no error, and no history row was written — which is what made every
other bug in the chat path invisible.
"""

import json

import httpx
import pytest

from app.api import chat as chat_api


@pytest.mark.asyncio
async def test_a_failure_mid_turn_yields_an_error_frame(monkeypatch):
    async def explode(*_args, **_kwargs):
        raise RuntimeError("the model fell over")
        yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(chat_api, "run_turn_stream", explode)

    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/chat/stream", json={"message": "chai 15"}, headers={"X-User": "stream-test"}
        )

    assert resp.status_code == 200, "the status went out before anything could fail"
    frames = [
        json.loads(line[6:])
        for line in resp.text.splitlines()
        if line.startswith("data: ")
    ]
    errors = [f for f in frames if f.get("type") == "error"]
    assert errors, f"no error frame in {frames}"
    # The class name is useful; the message could carry a query or a key.
    assert "RuntimeError" in errors[0]["detail"]
    assert "fell over" not in errors[0]["detail"]
