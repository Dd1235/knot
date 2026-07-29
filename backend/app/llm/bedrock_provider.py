"""Bedrock Converse implementation of the provider protocol.

boto3 is synchronous; calls run in a thread. Model ID comes from
BEDROCK_CHAT_MODEL (Claude, Nova — anything Converse-compatible).
"""

import asyncio
import json

from app.config import get_settings
from app.llm.provider import ChatResponse, ToolCall


def _to_bedrock_messages(messages: list[dict]) -> list[dict]:
    out: list[dict] = []
    for msg in messages:
        if msg["role"] == "tool":
            out.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "toolResult": {
                                "toolUseId": msg["call_id"],
                                "content": [{"json": json.loads(msg["content"])}],
                            }
                        }
                    ],
                }
            )
        elif msg["role"] == "assistant" and msg.get("tool_calls"):
            content: list[dict] = []
            if msg.get("content"):
                content.append({"text": msg["content"]})
            content += [
                {
                    "toolUse": {
                        "toolUseId": call["id"],
                        "name": call["name"],
                        "input": call["arguments"],
                    }
                }
                for call in msg["tool_calls"]
            ]
            out.append({"role": "assistant", "content": content})
        else:
            out.append({"role": msg["role"], "content": [{"text": msg["content"]}]})
    return out


def _to_bedrock_tools(tools: list[dict]) -> dict:
    return {
        "tools": [
            {
                "toolSpec": {
                    "name": tool["name"],
                    "description": tool["description"],
                    "inputSchema": {"json": tool["parameters"]},
                }
            }
            for tool in tools
        ]
    }


class BedrockProvider:
    def __init__(self) -> None:
        import os

        import boto3

        settings = get_settings()
        if settings.aws_bearer_token_bedrock:
            os.environ.setdefault(
                "AWS_BEARER_TOKEN_BEDROCK", settings.aws_bearer_token_bedrock
            )
        self._client = boto3.client("bedrock-runtime", region_name=settings.aws_region)
        self._model = settings.bedrock_chat_model

    def _converse(self, system: str, messages: list[dict], tools: list[dict]) -> dict:
        kwargs: dict = {
            "modelId": self._model,
            "system": [{"text": system}],
            "messages": _to_bedrock_messages(messages),
            "inferenceConfig": {"maxTokens": 1024, "temperature": 0.2},
        }
        if tools:
            kwargs["toolConfig"] = _to_bedrock_tools(tools)
        return self._client.converse(**kwargs)

    async def chat(
        self, system: str, messages: list[dict], tools: list[dict]
    ) -> ChatResponse:
        response = await asyncio.to_thread(self._converse, system, messages, tools)
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for block in response["output"]["message"]["content"]:
            if "text" in block:
                text_parts.append(block["text"])
            elif "toolUse" in block:
                tool_calls.append(
                    ToolCall(
                        id=block["toolUse"]["toolUseId"],
                        name=block["toolUse"]["name"],
                        arguments=block["toolUse"]["input"] or {},
                    )
                )
        return ChatResponse(text="\n".join(text_parts) or None, tool_calls=tool_calls)
