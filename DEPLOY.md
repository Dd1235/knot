# Deploying Knot

**Currently deployed:** backend on **AWS App Runner** (`ap-south-1`), frontend
on **Vercel**, database on **CockroachDB Cloud** (`aws-ap-south-1`). The
backend and the cluster share a region deliberately — a serializable ledger
reads inside the write, so the round trip is paid on every request. Measured:
~7 ms.

- API: `https://jmm87vpt23.ap-south-1.awsapprunner.com`
- App: `https://frontend-flame-chi-lahigc424k.vercel.app`
- Image: `public.ecr.aws/s5q3w4x0/knot-api:latest`

## Two things that bit, and why the setup looks odd

**1. `sslrootcert=system` is required.** The container ships no CA file, so
`sslmode=verify-full` fails at boot with *"root certificate file
/home/knot/.postgresql/root.crt does not exist"* — the first deployment died
exactly there, and CloudWatch is where that was read. CockroachDB Cloud
presents a publicly-trusted certificate, so pointing psycopg at the OS trust
store keeps verification full with nothing to ship or rotate. Append
`&sslrootcert=system` to `DATABASE_URL` for any containerised deployment.

**2. `iam:PassRole` is refused on this account**, which is why the image comes
from ECR *Public* and why secrets are runtime environment variables rather
than SSM `RuntimeEnvironmentSecrets`. Both of those need a role passed to
App Runner. Diagnosis: a service built from a public image (no role) creates
fine; the same service with an access role fails with *"Account … is not
authorized pass this role"* even with `PassRole` widened to `*`. The SSM
parameters are already created for the day it clears.

**Security consequence to close after judging:** `DATABASE_URL` sits in the
App Runner service configuration rather than in SSM. It is encrypted at rest
and readable only by principals in the account, but **rotate the CockroachDB
password once the demo is over**, and run the teardown.

## Redeploying the backend

```bash
docker build --platform linux/amd64 -t knot-api backend/
aws ecr-public get-login-password --region us-east-1 \
  | docker login --username AWS --password-stdin public.ecr.aws
docker tag knot-api public.ecr.aws/s5q3w4x0/knot-api:latest
docker push public.ecr.aws/s5q3w4x0/knot-api:latest
AWS_PROFILE=knot aws apprunner start-deployment --region ap-south-1 \
  --service-arn arn:aws:apprunner:ap-south-1:808175385445:service/knot-api/08dd79d24bc545a3972be4e32e8fc2cf
```

Migrations run at container boot, so a schema change ships with the image.

## Frontend

```bash
cd frontend && vercel link && vercel --prod
```

`NEXT_PUBLIC_API_URL` is set in the Vercel production environment. After a
domain change, update `CORS_ORIGINS` on the App Runner service or sign-in
breaks: the session cookie is `SameSite=None`, and the origin check is the
replacement CSRF defence.

## Tearing it all down

```bash
./scripts/aws-teardown.sh          # dry run — lists, deletes nothing
./scripts/aws-teardown.sh --yes    # applies
```

IAM is read with a separate profile (`IAM_PROFILE`, default `default`) because
`knot-deployer` deliberately cannot see IAM — without that split the dry run
reports "none" for resources that exist, which is the worst possible bug in a
teardown script.

## Fallback: Fly.io

`scripts/deploy-backend.sh` and `backend/fly.toml` deploy the same image to
Fly (`bom`) with `flyctl auth login`. Kept because it needs no `PassRole` and
builds remotely, so it works when AWS does not.

---

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
