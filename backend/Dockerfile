FROM python:3.12-slim AS runtime

# The same resolver as on a laptop, so a build cannot quietly pick different
# versions from the ones the tests ran against.
COPY --from=ghcr.io/astral-sh/uv:0.9.7 /uv /usr/local/bin/uv

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

WORKDIR /app

# Dependencies resolve from the lockfile alone, so this layer stays cached
# until the lockfile changes — editing app code does not reinstall anything.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app

# Cluster CA cert for sslmode=verify-full is baked in at build time via ARG,
# or mounted/downloaded at deploy time to this path.
ENV SSL_CERT_DIR=/etc/ssl/certs

# Nothing here needs root once the venv is built.
RUN useradd --create-home --uid 10001 knot && chown -R knot:knot /app
USER knot

# Hosts inject $PORT (Fly, Railway, App Runner all do). 8000 is only the local
# default — binding it literally is what makes a container start and then look
# unreachable.
ENV PORT=8000
EXPOSE 8000

# Migrations run at boot rather than as a separate release step. They are
# idempotent — schema_migrations records what has been applied — and this stops
# a fresh environment serving traffic against a schema that isn't there yet.
CMD ["sh", "-c", "uv run --no-sync python -m app.db.migrate && exec uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
