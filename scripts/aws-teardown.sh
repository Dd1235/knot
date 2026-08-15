#!/usr/bin/env bash
# Remove every AWS resource this project created, so the account goes quiet
# once judging is over.
#
#   ./scripts/aws-teardown.sh          # DRY RUN — lists, deletes nothing
#   ./scripts/aws-teardown.sh --yes    # actually deletes
#
# Order matters: App Runner holds the roles and the log groups, so the service
# has to reach DELETED before IAM will let go. Everything is idempotent —
# already-gone resources are reported as such rather than failing the run.
set -uo pipefail

ACCOUNT=808175385445
APP_REGION=ap-south-1
PUB_REGION=us-east-1          # ECR Public has a single control-plane region
SERVICE=knot-api
PROFILE="${AWS_PROFILE:-knot}"
# IAM is deliberately NOT in knot-deployer's policy (it can create nothing and
# read nothing there, and it certainly cannot delete itself). So IAM teardown
# runs as the admin/root session instead. A dry run under the scoped profile
# otherwise reports "none" for resources that plainly exist — a silent
# false negative, which is the worst possible bug in a teardown script.
IAM_PROFILE="${IAM_PROFILE:-default}"

APPLY=0
[ "${1:-}" = "--yes" ] && APPLY=1

aws_()    { AWS_PROFILE="$PROFILE" AWS_MAX_ATTEMPTS=3 aws "$@"; }
awsiam_() { AWS_PROFILE="$IAM_PROFILE" AWS_MAX_ATTEMPTS=3 aws "$@"; }
# Absent and forbidden are different answers; only one of them means "done".
exists_() {
  local out; out=$("$@" 2>&1); local rc=$?
  if [ $rc -eq 0 ]; then return 0; fi
  case "$out" in
    *AccessDenied*|*not\ authorized*|*ExpiredToken*|*InvalidClientTokenId*)
      return 2 ;;                       # cannot tell — report loudly
    *) return 1 ;;                      # genuinely absent
  esac
}
say()  { printf '  %-10s %s\n' "$1" "$2"; }

if [ "$APPLY" = "0" ]; then
  echo "DRY RUN — nothing will be deleted. Re-run with --yes to apply."
else
  echo "APPLYING — deleting resources in account $ACCOUNT."
fi
echo "profile: $PROFILE   (IAM via: $IAM_PROFILE)"
echo

# ── 1. App Runner ────────────────────────────────────────────────────────────
echo "App Runner ($APP_REGION)"
ARNS=$(aws_ apprunner list-services --region $APP_REGION \
        --query "ServiceSummaryList[?ServiceName=='$SERVICE'].ServiceArn" --output text 2>/dev/null)
if [ -z "$ARNS" ]; then
  say "none" "no $SERVICE service"
else
  for arn in $ARNS; do
    say "service" "$arn"
    if [ "$APPLY" = "1" ]; then
      aws_ apprunner delete-service --region $APP_REGION --service-arn "$arn" >/dev/null 2>&1
      # IAM refuses to release the roles while the service still references them.
      for _ in $(seq 1 40); do
        st=$(aws_ apprunner describe-service --region $APP_REGION --service-arn "$arn" \
              --query 'Service.Status' --output text 2>/dev/null)
        [ -z "$st" ] || [ "$st" = "DELETED" ] && break
        sleep 15
      done
      say "deleted" "$SERVICE"
    fi
  done
fi

# ── 2. CloudWatch log groups (App Runner creates these; they outlive it) ─────
echo
echo "CloudWatch Logs ($APP_REGION)"
LGS=$(aws_ logs describe-log-groups --region $APP_REGION \
       --log-group-name-prefix "/aws/apprunner/$SERVICE" \
       --query 'logGroups[].logGroupName' --output text 2>/dev/null)
if [ -z "$LGS" ]; then say "none" "no log groups"; else
  for lg in $LGS; do
    say "log group" "$lg"
    [ "$APPLY" = "1" ] && aws_ logs delete-log-group --region $APP_REGION --log-group-name "$lg" >/dev/null 2>&1
  done
fi

# ── 3. ECR Public ────────────────────────────────────────────────────────────
echo
echo "ECR Public ($PUB_REGION)"
if aws_ ecr-public describe-repositories --region $PUB_REGION --repository-names $SERVICE >/dev/null 2>&1; then
  say "repo" "public.ecr.aws/*/$SERVICE"
  [ "$APPLY" = "1" ] && aws_ ecr-public delete-repository --region $PUB_REGION \
      --repository-name $SERVICE --force >/dev/null 2>&1 && say "deleted" "$SERVICE"
else
  say "none" "no public repo"
fi

# ── 4. ECR private ───────────────────────────────────────────────────────────
echo
echo "ECR ($APP_REGION)"
if aws_ ecr describe-repositories --region $APP_REGION --repository-names $SERVICE >/dev/null 2>&1; then
  say "repo" "$ACCOUNT.dkr.ecr.$APP_REGION.amazonaws.com/$SERVICE"
  [ "$APPLY" = "1" ] && aws_ ecr delete-repository --region $APP_REGION \
      --repository-name $SERVICE --force >/dev/null 2>&1 && say "deleted" "$SERVICE"
else
  say "none" "no private repo"
fi

# ── 5. SSM parameters (these hold real secrets — delete them) ────────────────
echo
echo "SSM Parameter Store ($APP_REGION)"
for name in DATABASE_URL OPENAI_API_KEY SESSION_SECRET; do
  if aws_ ssm get-parameter --region $APP_REGION --name "/knot/$name" >/dev/null 2>&1; then
    say "param" "/knot/$name"
    [ "$APPLY" = "1" ] && aws_ ssm delete-parameter --region $APP_REGION --name "/knot/$name" >/dev/null 2>&1
  else
    say "none" "/knot/$name"
  fi
done

# ── 6. IAM user (access key first, then inline policies, then the user) ──────
echo
echo "IAM user"
exists_ awsiam_ iam get-user --user-name knot-deployer; rc=$?
if [ $rc -eq 2 ]; then
  say "UNKNOWN" "cannot read IAM as '$IAM_PROFILE' — rerun with IAM_PROFILE=<admin>"
elif [ $rc -eq 0 ]; then
  say "user" "knot-deployer"
  if [ "$APPLY" = "1" ]; then
    for k in $(awsiam_ iam list-access-keys --user-name knot-deployer \
                --query 'AccessKeyMetadata[].AccessKeyId' --output text 2>/dev/null); do
      awsiam_ iam delete-access-key --user-name knot-deployer --access-key-id "$k" >/dev/null 2>&1
      say "key" "$k revoked"
    done
    for pol in $(awsiam_ iam list-user-policies --user-name knot-deployer \
                  --query 'PolicyNames[]' --output text 2>/dev/null); do
      awsiam_ iam delete-user-policy --user-name knot-deployer --policy-name "$pol" >/dev/null 2>&1
    done
    awsiam_ iam delete-user --user-name knot-deployer >/dev/null 2>&1 && say "deleted" "knot-deployer"
  fi
else
  say "none" "no knot-deployer"
fi
echo "  NOTE: the [knot] profile in ~/.aws/credentials is not touched — remove it by hand."

# ── 7. IAM roles (managed policies must be detached before delete) ───────────
echo
echo "IAM roles"
for role in KnotAppRunnerECRAccess KnotAppRunnerInstance AppRunnerECRAccessRole; do
  exists_ awsiam_ iam get-role --role-name "$role"; rc=$?
  if [ $rc -eq 2 ]; then
    say "UNKNOWN" "$role — cannot read IAM as '$IAM_PROFILE'"
  elif [ $rc -eq 0 ]; then
    say "role" "$role"
    if [ "$APPLY" = "1" ]; then
      for arn in $(awsiam_ iam list-attached-role-policies --role-name "$role" \
                    --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null); do
        awsiam_ iam detach-role-policy --role-name "$role" --policy-arn "$arn" >/dev/null 2>&1
      done
      for pol in $(awsiam_ iam list-role-policies --role-name "$role" \
                    --query 'PolicyNames[]' --output text 2>/dev/null); do
        awsiam_ iam delete-role-policy --role-name "$role" --policy-name "$pol" >/dev/null 2>&1
      done
      awsiam_ iam delete-role --role-name "$role" >/dev/null 2>&1 && say "deleted" "$role"
    fi
  else
    say "none" "$role"
  fi
done
echo "  NOTE: AWSServiceRoleForAppRunner is AWS-managed and left alone."

# ── proof ────────────────────────────────────────────────────────────────────
echo
if [ "$APPLY" = "1" ]; then
  echo "Remaining:"
  say "services" "$(aws_ apprunner list-services --region $APP_REGION --query 'length(ServiceSummaryList)' --output text 2>/dev/null)"
  say "ecr" "$(aws_ ecr describe-repositories --region $APP_REGION --query 'length(repositories)' --output text 2>/dev/null)"
  echo
  echo "Also do by hand: rotate the CockroachDB password (it was an App Runner"
  echo "runtime env var), and delete the [knot] profile from ~/.aws/credentials."
else
  echo "Dry run complete. Nothing was deleted. Re-run with --yes to apply."
fi
