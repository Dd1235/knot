"""Provider-neutral embeddings, pinned to 512 dims and L2-normalized.

Normalized vectors make L2 distance monotonic with cosine distance, so the
same `<->` queries work identically for OpenAI and Bedrock Titan embeddings.
"""

import asyncio
import json
import math
from functools import lru_cache
from typing import Protocol

from app.config import get_settings


class EmbeddingProvider(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]: ...


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vector))
    return [x / norm for x in vector] if norm else vector


def to_pgvector(vector: list[float]) -> str:
    """Wire format for a VECTOR parameter: '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.7f}" for x in vector) + "]"


class OpenAIEmbeddings:
    def __init__(self) -> None:
        from openai import AsyncOpenAI

        settings = get_settings()
        self._client = AsyncOpenAI(api_key=settings.openai_api_key)
        self._model = settings.openai_embedding_model
        self._dims = settings.embedding_dims

    async def embed(self, texts: list[str]) -> list[list[float]]:
        response = await self._client.embeddings.create(
            model=self._model, input=texts, dimensions=self._dims
        )
        return [_normalize(item.embedding) for item in response.data]


class BedrockEmbeddings:
    """Titan Text Embeddings v2 via boto3 (sync SDK, run in a thread)."""

    def __init__(self) -> None:
        import boto3

        settings = get_settings()
        self._client = boto3.client("bedrock-runtime", region_name=settings.aws_region)
        self._model = settings.bedrock_embedding_model
        self._dims = settings.embedding_dims

    def _embed_one(self, text: str) -> list[float]:
        response = self._client.invoke_model(
            modelId=self._model,
            body=json.dumps({"inputText": text, "dimensions": self._dims, "normalize": True}),
        )
        return json.loads(response["body"].read())["embedding"]

    async def embed(self, texts: list[str]) -> list[list[float]]:
        return await asyncio.gather(
            *[asyncio.to_thread(self._embed_one, text) for text in texts]
        )


@lru_cache
def get_embedder() -> EmbeddingProvider:
    provider = get_settings().embedding_provider
    if provider == "openai":
        return OpenAIEmbeddings()
    if provider == "bedrock":
        return BedrockEmbeddings()
    raise ValueError(f"unknown EMBEDDING_PROVIDER: {provider}")


async def embed_one(text: str) -> list[float]:
    return (await get_embedder().embed([text]))[0]
