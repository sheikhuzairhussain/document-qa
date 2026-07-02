from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from alembic.config import Config
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from alembic import command
from backend.api.routers import documents
from backend.config import settings
from backend.lib.logging import scoped_logger

logger = scoped_logger("api")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("API startup started", app_title=app.title)
    started_at = time.perf_counter()
    alembic_cfg = Config("alembic.ini")
    # Run in a thread because alembic's env.py uses asyncio.run(),
    # which cannot nest inside the already-running event loop.
    try:
        logger.info("Database migrations started")
        await asyncio.to_thread(command.upgrade, alembic_cfg, "head")
        logger.info(
            "Database migrations completed",
            duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
        )
        yield
    except Exception:
        logger.exception(
            "API lifespan failed",
            duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
        )
        raise
    finally:
        logger.info("API shutdown completed")


app = FastAPI(title="Orbital Document Q&A", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router)
