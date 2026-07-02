from __future__ import annotations

import os

from pydantic_settings import BaseSettings

from backend.lib.logging import scoped_logger


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://orbital:orbital@db:5432/orbital_takehome"
    rag_database_url: str | None = None
    anthropic_api_key: str = ""
    google_api_key: str = ""
    upload_dir: str = "uploads"
    max_upload_size: int = 25 * 1024 * 1024  # 25MB
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")

    # Background job queue (RQ) — the ingestion worker reads from here.
    redis_url: str = "redis://redis:6379/0"

    # Embeddings. gemini-embedding-2 supports PDF input and configurable output
    # dimensionality; we request 1536 so it matches the document_chunks.embedding
    # column (see migration 003).
    embedding_model: str = "gemini-embedding-2"
    embedding_dim: int = 1536

    # Max number of concurrent page-embedding requests the ingestion worker issues.
    embedding_concurrency: int = 32

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
logger = scoped_logger("config")

# Ensure the API keys are available as environment variables so that the
# pydantic-ai Anthropic integration and the google-genai SDK can pick them up.
# google-genai reads GEMINI_API_KEY / GOOGLE_API_KEY from the environment
# automatically; the user's .env sets GOOGLE_API_KEY.
if settings.anthropic_api_key:
    os.environ.setdefault("ANTHROPIC_API_KEY", settings.anthropic_api_key)
if settings.google_api_key:
    os.environ.setdefault("GOOGLE_API_KEY", settings.google_api_key)

logger.debug(
    "Settings loaded",
    upload_dir=settings.upload_dir,
    max_upload_size=settings.max_upload_size,
    embedding_model=settings.embedding_model,
    embedding_dim=settings.embedding_dim,
    embedding_concurrency=settings.embedding_concurrency,
)
