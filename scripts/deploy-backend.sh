#!/usr/bin/env bash
# Deploy the backend to Fly.io, reading config out of the repo-root .env so
# nothing has to be pasted by hand (and nothing lands in shell history).
#
#   ./scripts/deploy-backend.sh [--frontend-origin https://your-app.vercel.app]
#
# Prerequisites: `flyctl auth login` (interactive, once).
# Docker is NOT required — Fly builds the image on a remote builder.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="knot-api"
FRONTEND_ORIGIN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --frontend-origin) FRONTEND_ORIGIN="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

command -v flyctl >/dev/null || { echo "flyctl not installed: brew install flyctl" >&2; exit 1; }
flyctl auth whoami >/dev/null 2>&1 || { echo "not logged in: run 'flyctl auth login'" >&2; exit 1; }
[ -f "$REPO_ROOT/.env" ] || { echo "no .env at $REPO_ROOT" >&2; exit 1; }

# Pull values without echoing them.
get() { grep -m1 "^$1=" "$REPO_ROOT/.env" | cut -d= -f2- | sed 's/^["'"'"']//;s/["'"'"']$//'; }
DATABASE_URL="$(get DATABASE_URL)"
OPENAI_API_KEY="$(get OPENAI_API_KEY)"
LLM_PROVIDER="$(get LLM_PROVIDER)"
EMBEDDING_PROVIDER="$(get EMBEDDING_PROVIDER)"
AWS_REGION="$(get AWS_REGION)"
AWS_BEARER_TOKEN_BEDROCK="$(get AWS_BEARER_TOKEN_BEDROCK)"

[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL missing from .env" >&2; exit 1; }
[ -n "$OPENAI_API_KEY" ] || echo "warning: OPENAI_API_KEY empty — chat will fail unless LLM_PROVIDER=bedrock works" >&2

cd "$REPO_ROOT/backend"

# Create the app on first run. fly.toml already pins the name and region (bom,
# co-located with the CockroachDB cluster in aws-ap-south-1).
if ! flyctl status -a "$APP" >/dev/null 2>&1; then
  echo "→ creating $APP"
  flyctl launch --no-deploy --copy-config --name "$APP" --region bom --yes
fi

echo "→ setting secrets"
# AUTH_REQUIRED is deliberately unset: it defaults to true, and validate_settings
# refuses to boot without a strong SESSION_SECRET and COOKIE_SECURE. Leaving it
# alone is what keeps production closed.
ARGS=(
  "DATABASE_URL=$DATABASE_URL"
  "SESSION_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')"
  "COOKIE_SECURE=true"
)
[ -n "$OPENAI_API_KEY" ] && ARGS+=("OPENAI_API_KEY=$OPENAI_API_KEY")
[ -n "$LLM_PROVIDER" ] && ARGS+=("LLM_PROVIDER=$LLM_PROVIDER")
[ -n "$EMBEDDING_PROVIDER" ] && ARGS+=("EMBEDDING_PROVIDER=$EMBEDDING_PROVIDER")
[ -n "$AWS_REGION" ] && ARGS+=("AWS_REGION=$AWS_REGION")
[ -n "$AWS_BEARER_TOKEN_BEDROCK" ] && ARGS+=("AWS_BEARER_TOKEN_BEDROCK=$AWS_BEARER_TOKEN_BEDROCK")
[ -n "$FRONTEND_ORIGIN" ] && ARGS+=("CORS_ORIGINS=$FRONTEND_ORIGIN")

flyctl secrets set --stage -a "$APP" "${ARGS[@]}" >/dev/null
echo "  ok ($(( ${#ARGS[@]} )) secrets staged)"

echo "→ deploying (remote builder; migrations run at boot)"
flyctl deploy -a "$APP" --remote-only

echo "→ health"
sleep 5
curl -fsS "https://$APP.fly.dev/healthz" && echo
echo
echo "Done. Next:"
echo "  1. cd frontend && vercel link && vercel --prod"
echo "  2. ./scripts/deploy-backend.sh --frontend-origin https://<your-vercel-domain>"
echo "     (re-run with the real origin, or cookies are refused cross-site)"
