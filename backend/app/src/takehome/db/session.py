from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker

from takehome.config import settings

engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session


# Synchronous engine/session for the RQ ingestion worker. RQ jobs run in plain
# (non-async) processes, so the worker uses psycopg rather than asyncpg. Engine
# creation is lazy and connects nothing at import time, so this is safe to define
# alongside the async engine even in the API process.
_sync_database_url = settings.database_url.replace("+asyncpg", "+psycopg")
sync_engine = create_engine(_sync_database_url, echo=False)
sync_session: sessionmaker[Session] = sessionmaker(sync_engine, expire_on_commit=False)
