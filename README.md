# Orbital — Product Engineering Take-Home

Welcome! This is a take-home assessment for a Product Engineering role at Orbital.

You've been given a working baseline application: a document Q&A tool for commercial real estate lawyers. Users upload legal documents (leases, title reports, environmental assessments) and ask questions about them. The AI assistant answers questions grounded in the document content.

The app works, but it has limitations. Your job is to extend it.

---

## Setup

### Prerequisites
- Docker and Docker Compose
- just (command runner) — install via `brew install just` or `cargo install just`

That's it. Everything else runs inside containers.

### Getting Started

1. Clone this repository

2. Run the setup command:
```
just setup
```
   This copies `.env.example` to `.env` and builds the Docker images.

3. Add your API keys to `.env`:
```
ANTHROPIC_API_KEY=your_key_here
GOOGLE_API_KEY=your_key_here
```
   The Anthropic key powers the chat/agent models; the Google key powers
   document-page and query **embeddings** for retrieval. We've provided an
   Anthropic key in the task email. You can also use your own.

   > Note: the databases use **ephemeral in-container storage** (no volumes), so
   > data is discarded when the containers are removed. Migrations re-run on
   > startup, so every fresh `just dev` starts from a clean, correctly-migrated
   > database.

4. Start everything:
```
just dev
```
   This starts PostgreSQL, the FastAPI API (port 8000), and the React frontend (port 5173).
   Database migrations run automatically when the API starts — no separate step needed.

5. Open http://localhost:5173 in your browser.

Your local `backend/` and `frontend/src/` directories are mounted into the containers —
edit files normally on your machine and changes hot-reload automatically.

### Document ingestion & retrieval

Uploaded PDFs are indexed by a background pipeline so the assistant can retrieve
the relevant passages instead of being handed the whole document:

1. **Upload** (`backend/lib/services/document.py`) — the file is stored, the
   `documents` row is created with `status="pending"`, and an ingestion job is
   pushed onto a Redis-backed **RQ** queue. Upload does not parse or extract the
   PDF.
2. **Worker** (`backend/lib/services/ingestion.py`, the `worker` service) —
   splits the PDF into single-page PDFs with **PyMuPDF**, extracts page text and
   block-level geometry, embeds each page with **Gemini Embedding 2**, and stores
   one row per page in `document_chunks`. Page embedding runs with 32 concurrent
   calls by default. The document moves `processing → completed` (or `failed`,
   with an error message). Scanned / image-only pages can still be visually
   searchable through the PDF embedding, but quoteable text is only stored when
   PyMuPDF can extract it.
3. **Status** — `status`, `chunk_count`, and `error` are returned by the
   documents API and shown per-row in the UI (it polls while indexing), with a
   "Retry processing" action for failures.
4. **Retrieval** — the `qa-agent` (`backend/agents/qa_agent/`) exposes a
   `search_documents` tool that runs **hybrid search** over `document_chunks`:
   dense similarity via **pgvectorscale** (StreamingDiskANN, `<=>`) fused with
   **pg_textsearch** BM25 keyword relevance (`<@>`) using **reciprocal rank
   fusion**.

Both vector and BM25 indexes come from the `timescale/timescaledb-ha` Postgres
image (replacing `postgres:16-alpine`), which bundles pgvector, pgvectorscale,
and pg_textsearch. `pg_textsearch` is enabled via `shared_preload_libraries` in
`docker-compose.yml`, and the DB uses ephemeral in-container storage (no volume).
The schema lives in migration `003`.

New services in `docker-compose.yml`: `redis` (queue broker) and `worker` (the
RQ consumer, sharing the API image). `just dev` starts them with the rest.

### Sample Documents

We've included sample legal documents in `sample-docs/` for testing.

### Project Structure

- `frontend/` — React frontend (Vite + Tailwind + shadcn/Radix UI)
- `backend/api/` — FastAPI app and API container entrypoint
- `backend/agents/` — Aegra-served LangGraph agents and agent container entrypoint
- `backend/lib/db/` — SQLAlchemy models and sessions
- `backend/lib/services/` — shared application services used by API, worker, and agents
- `alembic/` — Database migrations
- `data/` — Product analytics and customer feedback (for Part 2)
- `sample-docs/` — Sample PDF documents for testing

### Useful Commands

- `just dev` — Start full stack (Postgres + API + frontend)
- `just stop` — Stop all services
- `just reset` — Stop everything and clear database
- `just check` — Run all linters and type checks
- `just fmt` — Format all code
- `just db-init` — Run database migrations
- `just db-shell` — Open a psql shell
- `just shell-api` — Shell into API container
- `just logs-api` — Tail API logs
