from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]

# Signing keys that must never reach a public deployment.
DEV_SECRETS = {
    "dev",
    "dev-only-insecure-secret-change-in-production",
    "changeme",
    "secret",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=REPO_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str
    cors_origins: str = "http://localhost:3100"

    # Auth: signed session cookies. Secure by default — a deployment that
    # forgets to configure auth must fail closed, not silently serve every
    # account to anyone who guesses a handle.
    auth_required: bool = True
    # No default on purpose: pydantic-settings refuses to start without it, so
    # a known signing key cannot reach production. validate_settings() rejects
    # weak values when auth is on.
    session_secret: str
    cookie_secure: bool = False

    # S3 bucket for CSV exports (empty = stream the file inline instead).
    export_bucket: str = ""

    # Provider selection: "openai" (free dev mode) or "bedrock" (AWS-judged mode).
    llm_provider: str = "openai"
    embedding_provider: str = "openai"

    openai_api_key: str = ""
    openai_chat_model: str = "gpt-5-mini"
    openai_embedding_model: str = "text-embedding-3-small"

    aws_region: str = "us-east-1"
    # Bedrock API key (bearer auth) — exported to the process env so boto3
    # picks it up; falls back to the default credential chain when empty.
    aws_bearer_token_bedrock: str = ""
    # Nova Pro default (Claude needs the Anthropic use-case agreement first);
    # switch via BEDROCK_CHAT_MODEL, e.g. us.anthropic.claude-sonnet-4-5-20250929-v1:0
    bedrock_chat_model: str = "us.amazon.nova-pro-v1:0"
    bedrock_embedding_model: str = "amazon.titan-embed-text-v2:0"

    # Both text-embedding-3-small and Titan v2 support 512-dim output, so the
    # VECTOR(512) columns are provider-independent.
    embedding_dims: int = 512


def validate_settings(settings: Settings) -> None:
    """Refuse to boot an insecure deployment rather than serving one."""
    if not settings.auth_required:
        return
    secret = settings.session_secret.strip()
    if secret in DEV_SECRETS or len(secret) < 32:
        raise RuntimeError(
            "SESSION_SECRET must be a unique random value of at least 32 characters "
            "when AUTH_REQUIRED is on. Generate one with: "
            "python -c 'import secrets; print(secrets.token_urlsafe(48))'"
        )
    if not settings.cookie_secure:
        raise RuntimeError(
            "COOKIE_SECURE must be true when AUTH_REQUIRED is on, or session "
            "cookies will be sent over plaintext HTTP."
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
