# Default recipe - show available commands
default:
    @just --list

# =============================================================================
# Setup
# =============================================================================

# Initial project setup — one command to get going
setup:
    @echo "Setting up orbital-takehome..."
    @cp -n .env.example .env 2>/dev/null || true
    @mkdir -p uploads
    docker compose build
    @echo ""
    @echo "Setup complete! Next steps:"
    @echo "  1. Edit .env with your Anthropic API key"
    @echo "  2. Run 'just dev' to start everything"

# =============================================================================
# Development
# =============================================================================

# Start the full stack (Postgres, API, frontend, agents) with hot reload
dev:
    docker compose up

# Start in background
dev-detach:
    docker compose up -d

# Stop all services
stop:
    docker compose down

# Stop all services and remove database volumes (API + agents)
reset:
    docker compose down -v
    @echo "All data cleared. Run 'just dev' to start fresh."

# View API logs
logs-api:
    docker compose logs -f api

# Backward-compatible alias while muscle memory catches up.
logs-backend: logs-api

# View ingestion worker logs
logs-worker:
    docker compose logs -f worker

# View agents (Aegra) logs
logs-agents:
    docker compose logs -f agents

# View all logs
logs:
    docker compose logs -f

# =============================================================================
# Database
# =============================================================================

# Initialize / migrate database
db-init:
    docker compose exec api uv run alembic upgrade head
    @echo "Database initialised!"

# Create a new migration
db-migrate message:
    docker compose exec api uv run alembic revision --autogenerate -m "{{message}}"

# Apply pending migrations
db-upgrade:
    docker compose exec api uv run alembic upgrade head

# Open psql shell
db-shell:
    docker compose exec db psql -U orbital orbital_takehome

# Open psql shell on the Aegra (agents) database
db-shell-agents:
    docker compose exec agents-db psql -U agents aegra

# Apply Aegra migrations manually (runs automatically on container start)
agents-db-upgrade:
    docker compose exec agents aegra db upgrade

# =============================================================================
# Code Quality
# =============================================================================

# Run all checks
check: check-api check-frontend

# Run all tests
test: test-api

# Format all code
fmt: fmt-api fmt-frontend

# Python checks
check-api:
    docker compose exec api uv run ruff check backend
    docker compose exec api uv run pyright backend

# Backward-compatible alias while muscle memory catches up.
check-backend: check-api

# Python tests
test-api:
    docker compose exec api uv run pytest -q

# Backward-compatible alias while muscle memory catches up.
test-backend: test-api

# Format Python
fmt-api:
    docker compose exec api uv run ruff format backend
    docker compose exec api uv run ruff check --fix backend

# Backward-compatible alias while muscle memory catches up.
fmt-backend: fmt-api

# Frontend checks
check-frontend:
    docker compose exec frontend npm run check

# Format frontend
fmt-frontend:
    docker compose exec frontend npm run fmt

# =============================================================================
# Utilities
# =============================================================================

# Shell into API container
shell-api:
    docker compose exec api bash

# Backward-compatible alias while muscle memory catches up.
shell-backend: shell-api

# Shell into frontend container
shell-frontend:
    docker compose exec frontend bash

# Shell into agents (Aegra) container
shell-agents:
    docker compose exec agents bash

# Install a new Python dependency
add-dep package:
    docker compose exec api uv add {{package}}

# Install a new frontend dependency
add-dep-frontend package:
    docker compose exec frontend npm install {{package}}
