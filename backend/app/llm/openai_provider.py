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

    async def chat(
        self, system: str, messages: list[dict], tools: list[dict]
    ) -> ChatResponse:
        completion = await self._client.chat.completions.create(
            model=self._model,
            messages=_to_openai_messages(system, messages),
            tools=_to_openai_tools(tools) if tools else None,
            temperature=0.2,
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
