"""Provider-neutral chat interface.

Internal message format (provider implementations translate to their wire
format):
    {"role": "user" | "assistant", "content": str}
    {"role": "assistant", "content": str | None, "tool_calls": [ToolCall-dict]}
    {"role": "tool", "call_id": str, "content": str}

Tool call dicts carry parsed-arguments: {"id": str, "name": str, "arguments": dict}.
"""

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class ChatResponse:
    text: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)


class LLMProvider(Protocol):
    async def chat(
        self, system: str, messages: list[dict], tools: list[dict]
    ) -> ChatResponse:
        """Run one model call. `tools` uses neutral specs:
        [{"name", "description", "parameters": <json-schema>}]."""
        ...


def get_provider() -> LLMProvider:
    from app.config import get_settings

    settings = get_settings()
    if settings.llm_provider == "openai":
        from app.llm.openai_provider import OpenAIProvider

        return OpenAIProvider()
    if settings.llm_provider == "bedrock":
        from app.llm.bedrock_provider import BedrockProvider

        return BedrockProvider()
    raise ValueError(f"unknown LLM_PROVIDER: {settings.llm_provider}")
