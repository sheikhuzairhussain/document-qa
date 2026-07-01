FROM python:3.12-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Python needs the repo root so backend.* imports resolve in dev and runtime.
ENV PYTHONPATH=/app:$PYTHONPATH

# Copy dependency files first (layer caching)
COPY pyproject.toml uv.lock* ./

# Install dependencies. The API and RQ worker share this image; ingestion uses
# PyMuPDF + Gemini embeddings and needs no local OCR/document-understanding models.
RUN uv sync --group dev

# Copy API plus shared libraries (will be overridden by volume mount in dev)
COPY backend/__init__.py ./backend/__init__.py
COPY backend/config.py ./backend/config.py
COPY backend/api ./backend/api
COPY backend/lib ./backend/lib
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "backend.api.app:app", "--reload", "--host", "0.0.0.0", "--port", "8000"]
