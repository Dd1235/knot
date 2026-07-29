import json

from openai import AsyncOpenAI

from app.config import get_settings
from app.llm.provider import ChatResponse, ToolCall


def _to_openai_messages(system: str, messages: list[dict]) -> list[dict]:
    out: list[dict] = [{"role": "system", "content": system}]
    for msg in messages:
        if msg["role"] == "tool":
            out.append(
                {"role": "tool", "tool_call_id": msg["call_id"], "content": msg["content"]}
            )
        elif msg["role"] == "assistant" and msg.get("tool_calls"):
            out.append(
                {
                    "role": "assistant",
                    "content": msg.get("content"),
                    "tool_calls": [
                        {
                            "id": call["id"],
                            "type": "function",
                            "function": {
                                "name": call["name"],
                                "arguments": json.dumps(call["arguments"]),
                            },
                        }
                        for call in msg["tool_calls"]
                    ],
                }
            )
        else:
            out.append({"role": msg["role"], "content": msg["content"]})
    return out


def _to_openai_tools(tools: list[dict]) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool["description"],
                "parameters": tool["parameters"],
            },
        }
        for tool in tools
    ]


class OpenAIProvider:
    def __init__(self) -> None:
        settings = get_settings()
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._model = settings.openai_chat_model

    def _kwargs(self, system: str, messages: list[dict], tools: list[dict]) -> dict:
        kwargs: dict = {
            "model": self._model,
            "messages": _to_openai_messages(system, messages),
        }
        if tools:
            kwargs["tools"] = _to_openai_tools(tools)
        if self._model.startswith(("gpt-5", "o")):
            # Reasoning models: fixed temperature; keep latency low.
            kwargs["reasoning_effort"] = "low"
        else:
            kwargs["temperature"] = 0.2
        return kwargs

    async def chat(
        self, system: str, messages: list[dict], tools: list[dict]
    ) -> ChatResponse:
        completion = await self._client.chat.completions.create(
            **self._kwargs(system, messages, tools)
        )
        choice = completion.choices[0].message
        tool_calls = [
            ToolCall(
                id=call.id,
                name=call.function.name,
                arguments=json.loads(call.function.arguments or "{}"),
            )
            for call in (choice.tool_calls or [])
        ]
        return ChatResponse(text=choice.content, tool_calls=tool_calls)

    async def chat_stream(self, system: str, messages: list[dict], tools: list[dict]):
        stream = await self._client.chat.completions.create(
            **self._kwargs(system, messages, tools), stream=True
        )
        text_parts: list[str] = []
        partial_calls: dict[int, dict] = {}
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if delta is None:
                continue
            if delta.content:
                text_parts.append(delta.content)
                yield {"type": "text_delta", "text": delta.content}
            for tc in delta.tool_calls or []:
                entry = partial_calls.setdefault(tc.index, {"id": "", "name": "", "args": ""})
                if tc.id:
                    entry["id"] = tc.id
                if tc.function and tc.function.name:
                    entry["name"] = tc.function.name
                if tc.function and tc.function.arguments:
                    entry["args"] += tc.function.arguments

        tool_calls = [
            ToolCall(
                id=entry["id"],
                name=entry["name"],
                arguments=json.loads(entry["args"] or "{}"),
            )
            for _, entry in sorted(partial_calls.items())
        ]
        yield {
            "type": "response",
            "response": ChatResponse(text="".join(text_parts) or None, tool_calls=tool_calls),
        }
