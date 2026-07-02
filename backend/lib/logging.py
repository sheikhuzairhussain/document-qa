from __future__ import annotations

import os
import sys
from collections.abc import Mapping
from typing import TYPE_CHECKING, Final

from loguru import logger as _logger

if TYPE_CHECKING:
    from loguru import Record

DEFAULT_LOG_LEVEL: Final = "INFO"
CONTEXT_FIELD: Final = "context"
SCOPE_FIELD: Final = "scope"

_configured = False


class ScopedLogger:
    """Small Loguru adapter with contextual calls."""

    def __init__(self, scope: str, context: Mapping[str, object] | None = None) -> None:
        self._scope = scope
        self._context = dict(context or {})

    def bind(self, **context: object) -> ScopedLogger:
        return ScopedLogger(self._scope, self._context | context)

    def debug(self, message: str, **context: object) -> None:
        self._log("DEBUG", message, context)

    def info(self, message: str, **context: object) -> None:
        self._log("INFO", message, context)

    def warning(self, message: str, **context: object) -> None:
        self._log("WARNING", message, context)

    def error(self, message: str, **context: object) -> None:
        self._log("ERROR", message, context)

    def exception(self, message: str, **context: object) -> None:
        configure_logging()
        _logger.bind(scope=self._scope, **self._context, **context).opt(
            depth=2,
            exception=True,
        ).error(message)

    def _log(self, level: str, message: str, context: Mapping[str, object]) -> None:
        configure_logging()
        _logger.bind(scope=self._scope, **self._context, **context).opt(depth=2).log(
            level,
            message,
        )


def scoped_logger(scope: str) -> ScopedLogger:
    """Return a Loguru logger bound to an application scope."""
    configure_logging()
    return ScopedLogger(scope)


def configure_logging() -> None:
    global _configured
    if _configured:
        return

    _logger.remove()
    _logger.configure(patcher=_patch_record)
    _logger.add(
        sys.stderr,
        level=os.getenv("LOG_LEVEL", DEFAULT_LOG_LEVEL).upper(),
        format=(
            "{time:YYYY-MM-DD HH:mm:ss.SSS} | {level:<8} | "
            "{process.name}:{process.id} | {extra[scope]} | {message}{extra[context]}\n"
            "{exception}"
        ),
        colorize=False,
        backtrace=False,
        diagnose=False,
    )
    _configured = True


def _patch_record(record: Record) -> None:
    extra = record["extra"]
    extra.setdefault(SCOPE_FIELD, "app")
    extra[CONTEXT_FIELD] = _format_context(extra)


def _format_context(extra: Mapping[str, object]) -> str:
    fields = [
        (key, value)
        for key, value in extra.items()
        if key not in {SCOPE_FIELD, CONTEXT_FIELD}
    ]
    if not fields:
        return ""

    return " | " + " ".join(f"{key}={value!r}" for key, value in fields)
