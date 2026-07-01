# Aegra agent runtime. Builds from the repo root and installs the *shared* root
# pyproject (which carries aegra-cli + deepagents) — agents has no pyproject of its own.
# The shared aegra.json references ./backend/agents/src, so we mirror that layout in-container.
#   build context: .            (repo root)
#   dockerfile:    backend/agents/Dockerfile
FROM python:3.12-slim-bookworm AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Non-root runtime user
RUN addgroup --system app && adduser --system --ingroup app app

# -----------------------------
# Builder stage — install shared root deps into /app/.venv
# -----------------------------
FROM base AS builder

COPY --from=ghcr.io/astral-sh/uv:0.10.0 /uv /bin/uv

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies only (--no-install-project): the agent loads its graph via
# aegra.json path injection, so it never imports the orbital-takehome package and
# doesn't need backend/app/src copied in.
COPY pyproject.toml uv.lock* ./
RUN uv sync --no-dev --no-install-project --compile-bytecode

# -----------------------------
# Runtime stage
# -----------------------------
FROM base AS final

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.venv /app/.venv

# Mirror the repo-root layout: aegra.json at /app, graph source at /app/backend/agents/src.
# In dev these are bind-mounted over by docker-compose; baked in for standalone runs.
COPY aegra.json /app/aegra.json
COPY backend/agents/src /app/backend/agents/src

ENV PATH="/app/.venv/bin:$PATH" \
    AEGRA_CONFIG=/app/aegra.json

WORKDIR /app

EXPOSE 2026

USER app

CMD ["aegra", "serve", "--host", "0.0.0.0", "--port", "2026"]
