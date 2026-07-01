from __future__ import annotations

import ast
from pathlib import Path

APP_LAYER_ROOTS = (Path("backend/api"), Path("backend/agents"))
FORBIDDEN_APP_LAYER_IMPORTS = ("backend.lib.db", "sqlalchemy", "psycopg")


def test_api_and_agents_do_not_import_database_layer_directly() -> None:
    offenders: list[str] = []

    for root in APP_LAYER_ROOTS:
        for path in root.rglob("*.py"):
            if "skills" in path.parts:
                continue

            imported_modules = _imported_modules(path)
            forbidden_imports = sorted(
                module
                for module in imported_modules
                if module.startswith(FORBIDDEN_APP_LAYER_IMPORTS)
            )
            if forbidden_imports:
                offenders.append(f"{path}: {', '.join(forbidden_imports)}")

    assert offenders == []


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text())
    modules: set[str] = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            modules.add(node.module)

    return modules
