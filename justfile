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

# Start the full stack (Postgres, backend, frontend, agents) with hot reload
dev:
    docker compose up

# Start in background
dev-detach:
    docker compose up -d

# Stop all services
stop:
    docker compose down

# Stop all services and remove database volumes (backend + agents)
reset:
    docker compose down -v
    @echo "All data cleared. Run 'just dev' to start fresh."

# View backend logs
logs-backend:
    docker compose logs -f backend

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
    docker compose exec backend uv run alembic upgrade head
    @echo "Database initialised!"

# Create a new migration
db-migrate message:
    docker compose exec backend uv run alembic revision --autogenerate -m "{{message}}"

# Apply pending migrations
db-upgrade:
    docker compose exec backend uv run alembic upgrade head

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
check: check-backend check-frontend

# Format all code
fmt: fmt-backend fmt-frontend

# Python checks
check-backend:
    docker compose exec backend uv run ruff check backend/app/src
    docker compose exec backend uv run pyright backend/app/src

# Format Python
fmt-backend:
    docker compose exec backend uv run ruff format backend/app/src
    docker compose exec backend uv run ruff check --fix backend/app/src

# Frontend checks
check-frontend:
    docker compose exec frontend npm run check

# Format frontend
fmt-frontend:
    docker compose exec frontend npm run fmt

# =============================================================================
# Utilities
# =============================================================================

# Shell into backend container
shell-backend:
    docker compose exec backend bash

# Shell into frontend container
shell-frontend:
    docker compose exec frontend bash

# Shell into agents (Aegra) container
shell-agents:
    docker compose exec agents bash

# Install a new Python dependency
add-dep package:
    docker compose exec backend uv add {{package}}

# Install a new frontend dependency
add-dep-frontend package:
    docker compose exec frontend npm install {{package}}
