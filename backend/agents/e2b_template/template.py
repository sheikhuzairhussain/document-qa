"""E2B template for QA agent sandbox-backed skills."""

from __future__ import annotations

from pathlib import Path

from e2b import Template

_TEMPLATE_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _TEMPLATE_DIR.parents[2]
_SKILLS_DIR = "backend/agents/src/qa_agent/skills"
_SMOKE_CHECK = "backend/agents/e2b_template/smoke_check.py"

_APT_PACKAGES = [
    "build-essential",
    "ca-certificates",
    "curl",
    "default-jre-headless",
    "fonts-dejavu",
    "fonts-liberation",
    "libreoffice",
    "nodejs",
    "npm",
    "pandoc",
    "poppler-utils",
    "qpdf",
    "tesseract-ocr",
]

_PYTHON_PACKAGES = [
    "defusedxml",
    "lxml",
    "markitdown[pptx]",
    "openpyxl",
    "pandas",
    "pdf2image",
    "pdfplumber",
    "pillow",
    "pypdf",
    "pytesseract",
    "reportlab",
]

_NODE_PACKAGES = [
    "docx",
    "pptxgenjs",
    "react",
    "react-dom",
    "react-icons",
    "sharp",
]


template = (
    Template(
        file_context_path=_REPO_ROOT,
        file_ignore_patterns=[
            ".git",
            ".venv",
            "frontend/node_modules",
            "uploads",
        ],
    )
    .from_python_image("3.12")
    .run_cmd(
        "apt-get update && apt-get install -y --no-install-recommends "
        + " ".join(_APT_PACKAGES)
        + " && rm -rf /var/lib/apt/lists/*",
        user="root",
    )
    .run_cmd(
        "python -m pip install --upgrade pip && python -m pip install --no-cache-dir "
        + " ".join(f'"{package}"' for package in _PYTHON_PACKAGES),
        user="root",
    )
    .run_cmd(
        "npm config set prefix /usr/local && npm install -g " + " ".join(_NODE_PACKAGES),
        user="root",
    )
    .run_cmd(
        "ln -sfn /usr/local/lib/node_modules /home/user/node_modules "
        "&& chown -h user:user /home/user/node_modules",
        user="root",
    )
    .run_cmd("mkdir -p /skills && chmod 755 /skills", user="root")
    .copy(_SKILLS_DIR, "/skills", user="root", mode=0o755)
    .copy(_SMOKE_CHECK, "/usr/local/bin/qa-agent-sandbox-smoke", user="root", mode=0o755)
    .run_cmd("chmod -R a+rX /skills /usr/local/bin/qa-agent-sandbox-smoke", user="root")
    .set_envs(
        {
            "NODE_PATH": "/usr/local/lib/node_modules",
            "PYTHONUNBUFFERED": "1",
        }
    )
    .set_workdir("/home/user")
)
