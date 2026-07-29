from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str

    # Provider selection: "openai" (free dev mode) or "bedrock" (AWS-judged mode).
    llm_provider: str = "openai"
    embedding_provider: str = "openai"

    openai_api_key: str = ""
    openai_chat_model: str = "gpt-4.1-mini"
    openai_embedding_model: str = "text-embedding-3-small"

    aws_region: str = "us-east-1"
    bedrock_chat_model: str = "anthropic.claude-sonnet-4-5-v1:0"
    bedrock_embedding_model: str = "amazon.titan-embed-text-v2:0"

    # Both text-embedding-3-small and Titan v2 support 512-dim output, so the
    # VECTOR(512) columns are provider-independent.
    embedding_dims: int = 512


@lru_cache
def get_settings() -> Settings:
    return Settings()
