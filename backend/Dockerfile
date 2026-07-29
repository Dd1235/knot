FROM python:3.12-slim AS runtime

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app

# Cluster CA cert for sslmode=verify-full is baked in at build time via ARG,
# or mounted/downloaded at deploy time to this path.
ENV SSL_CERT_DIR=/etc/ssl/certs

EXPOSE 8000

CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
