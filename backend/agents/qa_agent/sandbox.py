"""E2B sandbox backend wiring for the QA agent."""

from __future__ import annotations

import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final, TypeGuard

from e2b import Sandbox
from langchain_e2b import E2BSandbox

from backend.lib.logging import scoped_logger

logger = scoped_logger("agents:qa_agent")

E2B_TEMPLATE_ID: Final = "qa-agent-sandbox"
SANDBOX_TIMEOUT_SECONDS: Final = 15 * 60
COMMAND_TIMEOUT_SECONDS: Final = 5 * 60
ALLOW_INTERNET_ACCESS: Final = False
SANDBOX_CACHE_SAFETY_MARGIN_SECONDS: Final = 30
DOWNLOAD_URL_EXPIRATION_SECONDS: Final = 15 * 60


@dataclass(frozen=True)
class _SandboxCacheEntry:
    sandbox: Sandbox
    backend: E2BSandbox
    created_at: float


_SANDBOXES_BY_THREAD: dict[str, _SandboxCacheEntry] = {}


def get_thread_id(config: object) -> str | None:
    """Extract the server-authoritative thread id from a LangGraph config."""
    if not _is_object_mapping(config):
        return None

    configurable = config.get("configurable")
    if not _is_object_mapping(configurable):
        return None

    thread_id = configurable.get("thread_id")
    if not isinstance(thread_id, str) or not thread_id.strip():
        return None

    return thread_id


def get_sandbox_backend(thread_id: str) -> E2BSandbox:
    """Return the E2B backend for a thread, creating it on first use."""
    logger.debug("Sandbox backend requested", thread_id=thread_id)
    return _get_sandbox_cache_entry(thread_id).backend


def get_sandbox(thread_id: str) -> Sandbox:
    """Return the raw E2B sandbox for a thread, creating it on first use."""
    logger.debug("Sandbox requested", thread_id=thread_id)
    return _get_sandbox_cache_entry(thread_id).sandbox


def _get_sandbox_cache_entry(thread_id: str) -> _SandboxCacheEntry:
    entry = _SANDBOXES_BY_THREAD.get(thread_id)
    if entry is not None and not _is_expired(entry):
        logger.debug(
            "Reusing cached E2B sandbox",
            thread_id=thread_id,
            sandbox_id=entry.backend.id,
        )
        return entry
    if entry is not None:
        logger.info(
            "Cached E2B sandbox expired",
            thread_id=thread_id,
            sandbox_id=entry.backend.id,
        )

    _required_env("E2B_API_KEY")
    started_at = time.perf_counter()
    logger.info(
        "Creating E2B sandbox",
        thread_id=thread_id,
        template_id=E2B_TEMPLATE_ID,
        sandbox_timeout_seconds=SANDBOX_TIMEOUT_SECONDS,
        command_timeout_seconds=COMMAND_TIMEOUT_SECONDS,
        allow_internet_access=ALLOW_INTERNET_ACCESS,
    )
    try:
        sandbox = Sandbox.create(
            template=E2B_TEMPLATE_ID,
            timeout=SANDBOX_TIMEOUT_SECONDS,
            secure=True,
            allow_internet_access=ALLOW_INTERNET_ACCESS,
            metadata={
                "agent": "qa-agent",
                "thread_id": thread_id,
            },
        )
    except Exception:
        logger.exception(
            "E2B sandbox creation failed",
            thread_id=thread_id,
            duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
        )
        raise
    backend = E2BSandbox(sandbox=sandbox, timeout=COMMAND_TIMEOUT_SECONDS)
    _SANDBOXES_BY_THREAD[thread_id] = _SandboxCacheEntry(
        sandbox=sandbox,
        backend=backend,
        created_at=time.monotonic(),
    )
    logger.info(
        "E2B sandbox created",
        thread_id=thread_id,
        sandbox_id=backend.id,
        template_id=E2B_TEMPLATE_ID,
        sandbox_timeout_seconds=SANDBOX_TIMEOUT_SECONDS,
        command_timeout_seconds=COMMAND_TIMEOUT_SECONDS,
        allow_internet_access=ALLOW_INTERNET_ACCESS,
        duration_ms=round((time.perf_counter() - started_at) * 1000, 2),
    )
    return _SANDBOXES_BY_THREAD[thread_id]


def _is_expired(entry: _SandboxCacheEntry) -> bool:
    max_age = SANDBOX_TIMEOUT_SECONDS - SANDBOX_CACHE_SAFETY_MARGIN_SECONDS
    return time.monotonic() - entry.created_at >= max_age


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        logger.error("Required sandbox environment variable missing", name=name)
        msg = f"{name} is required for sandboxed QA agent runs"
        raise RuntimeError(msg)
    return value


def _is_object_mapping(value: object) -> TypeGuard[Mapping[str, object]]:
    return isinstance(value, Mapping)
