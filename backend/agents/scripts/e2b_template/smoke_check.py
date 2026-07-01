#!/usr/bin/env python3
"""Smoke-check the QA agent E2B template contents."""

from __future__ import annotations

import importlib
import shutil
import subprocess
import sys
from pathlib import Path

PYTHON_MODULES = [
    "defusedxml",
    "lxml",
    "markitdown",
    "openpyxl",
    "pandas",
    "pdf2image",
    "pdfplumber",
    "PIL",
    "pypdf",
    "pytesseract",
    "reportlab",
]

COMMANDS = [
    "node",
    "npm",
    "pandoc",
    "pdftoppm",
    "qpdf",
    "soffice",
    "tesseract",
]

SKILLS = [
    "docx",
    "pdf",
    "pptx",
    "xlsx",
]

NODE_REQUIRE_SCRIPT = """
const packages = ["docx", "pptxgenjs", "react", "react-dom", "react-icons/fa", "sharp"];
for (const pkg of packages) {
  require(pkg);
}
"""


def main() -> int:
    failures: list[str] = []

    for module_name in PYTHON_MODULES:
        try:
            importlib.import_module(module_name)
        except Exception as exc:  # noqa: BLE001 - report all smoke-check failures.
            failures.append(f"Python module {module_name!r} failed to import: {exc}")

    for command in COMMANDS:
        if shutil.which(command) is None:
            failures.append(f"Command {command!r} is not on PATH")

    skills_root = Path("/skills")
    for skill in SKILLS:
        skill_file = skills_root / skill / "SKILL.md"
        if not skill_file.is_file():
            failures.append(f"Missing skill file: {skill_file}")

    node_result = subprocess.run(
        ["node", "-e", NODE_REQUIRE_SCRIPT],
        check=False,
        capture_output=True,
        text=True,
    )
    if node_result.returncode != 0:
        failures.append(
            "Node package require check failed: "
            + (node_result.stderr.strip() or node_result.stdout.strip())
        )

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1

    print("qa-agent-sandbox smoke check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
