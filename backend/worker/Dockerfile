FROM python:3.12-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Python needs the repo root so backend.* imports resolve in dev and runtime.
ENV PYTHONPATH=/app:$PYTHONPATH

# Copy dependency files first (layer caching)
COPY pyproject.toml uv.lock* ./

# Install dependencies. The worker needs PyMuPDF, Redis/RQ, psycopg, and Gemini
# embeddings, but no API server runtime beyond shared project dependencies.
RUN uv sync --group dev

# Copy worker plus shared libraries (will be overridden by volume mount in dev)
COPY backend/__init__.py ./backend/__init__.py
COPY backend/config.py ./backend/config.py
COPY backend/worker ./backend/worker
COPY backend/lib ./backend/lib

# Create uploads directory
RUN mkdir -p uploads

CMD ["uv", "run", "rq", "worker", "--worker-class", "rq.SimpleWorker", "ingestion", "--url", "redis://redis:6379/0"]

