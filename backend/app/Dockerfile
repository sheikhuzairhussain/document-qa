FROM python:3.12-slim

WORKDIR /app

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Python needs to find the takehome package inside backend/app/src
ENV PYTHONPATH=/app/backend/app/src:$PYTHONPATH

# Copy dependency files first (layer caching)
COPY pyproject.toml uv.lock* ./

# Install dependencies. The API and RQ worker share this image; ingestion uses
# PyMuPDF + Gemini embeddings and needs no local OCR/document-understanding models.
RUN uv sync --group dev

# Copy source (will be overridden by volume mount in dev)
COPY backend/app/src ./backend/app/src
COPY alembic ./alembic
COPY alembic.ini ./alembic.ini

# Create uploads directory
RUN mkdir -p uploads

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "takehome.web.app:app", "--reload", "--host", "0.0.0.0", "--port", "8000"]
