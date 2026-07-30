# Deploying Knot

Backend on Fly.io, frontend on Vercel, database already on CockroachDB Cloud.
Chosen over AWS App Runner because App Runner needs account verification that
has been pending for a while, and the submission needs a URL more than it needs
a particular host. AWS still appears where it genuinely does work — S3 for
exports, CloudWatch for logs.

Everything below is idempotent; re-running is safe.

---

## Backend → Fly.io

```bash
brew install flyctl          # or: curl -L https://fly.io/install.sh | sh
fly auth login
cd backend
fly launch --no-deploy --copy-config    # reads fly.toml, keeps app name + region
```

Set secrets. **These are secrets, not `[env]`** — anything in `fly.toml` is
committed to the repo:

```bash
fly secrets set \
  DATABASE_URL='postgresql://…@…cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full' \
  SESSION_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')" \
  OPENAI_API_KEY='sk-…' \
  COOKIE_SECURE=true \
  CORS_ORIGINS='https://<your-vercel-domain>'
```

Deliberately **not** set: `AUTH_REQUIRED`. It defaults to true and the app
refuses to boot with an insecure config, so leaving it unset is what keeps
production closed. Setting it to `false` disables authentication entirely.

```bash
fly deploy
fly logs                     # migrations run at boot; watch them apply
curl https://knot-api.fly.dev/healthz
```

---

## Frontend → Vercel

```bash
npm i -g vercel
cd frontend
vercel link
vercel env add NEXT_PUBLIC_API_URL production   # https://knot-api.fly.dev
vercel --prod
```

Then point the backend at the real frontend origin, or cookies will not be
accepted cross-site:

```bash
fly secrets set CORS_ORIGINS='https://<your-vercel-domain>' -a knot-api
```

---

## Verifying a real deployment

Not "it returned 200" — the invariant, on the deployed instance:

1. `GET /healthz` → `{"ok": true}`.
2. Sign up, then reload. If the session survives, `COOKIE_SECURE` and
   `CORS_ORIGINS` are right; if you are bounced to `/login`, they are not.
3. Say or type a few transactions, then open `/architecture` — the invariant
   card reads the legs count and their sum **out of the cluster at page load**.
   If it says 0.00, double-entry is holding in production.
4. `/demo` → run the race. One settlement commits, the rest are rejected with
   retries, ledger sum stays 0. That is serializable isolation on the live
   cluster rather than on a laptop.

## Notes

- **The image has not been built locally** — Docker was not running on the
  machine where this was written. Expect the first `fly deploy` to surface any
  build issue; the Dockerfile is a normal `python:3.12-slim` + `uv sync`, so
  problems are most likely a missing lockfile entry.
- Migrations run in the container's `CMD` before uvicorn starts. They are
  tracked in `schema_migrations`, so a redeploy applies only what is new.
- `min_machines_running = 0` means the first request after idle pays a cold
  start. Set it to 1 the day before judging.
- Region `bom` matches the CockroachDB cluster in `aws-ap-south-1`. A
  serializable transaction reads and writes in one round trip; putting the app
  on another continent is felt on every request.
