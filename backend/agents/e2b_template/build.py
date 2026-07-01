"""Build the E2B QA agent sandbox template."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from e2b import Template, default_build_logger
from template import template

TEMPLATE_ALIAS = "qa-agent-sandbox"
CPU_COUNT = 2
MEMORY_MB = 4096


def main() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    load_dotenv(repo_root / ".env")

    _required_env("E2B_API_KEY")
    build_info = Template.build(
        template,
        alias=TEMPLATE_ALIAS,
        cpu_count=CPU_COUNT,
        memory_mb=MEMORY_MB,
        on_build_logs=default_build_logger(),
    )
    print(f"Built E2B template alias: {TEMPLATE_ALIAS}")
    print(build_info)


def _required_env(name: str) -> str:
    value = os.getenv(name)
    if value is None or not value.strip():
        msg = f"{name} is required to build the E2B template"
        raise RuntimeError(msg)
    return value


if __name__ == "__main__":
    main()
