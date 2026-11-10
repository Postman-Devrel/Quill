#!/usr/bin/env bash
# Runs the Quill external-API collections against live services.
# Secrets are read from the environment (or .env) and passed with --env-var; they are never printed or written to files.
# Usage: scripts/api-tests/run.sh [collection-dir-name ...]   (default: all)
set -uo pipefail
cd "$(dirname "$0")/../.."

# Locally, secrets come from .env; in CI they are already in the environment.
if [[ -f ./.env ]]; then set -a; . ./.env; set +a; fi
ENVFILE="postman/environments/Quill.environment.yaml"
REPORTS="${REPORTS_DIR:-postman/reports}"
b64() { printf '%s' "$1" | base64 | tr -d '\n'; }

ARGS=(
  --env-var "anthropic_api_key=${ANTHROPIC_API_KEY:-}"
  --env-var "tavily_api_key=${TAVILY_API_KEY:-}"
  --env-var "wp_basic_auth=$(b64 "${WP_USERNAME:-}:${WP_APP_PASSWORD:-}")"
  --env-var "atlassian_basic_auth=$(b64 "${CONFLUENCE_EMAIL:-}:${CONFLUENCE_API_TOKEN:-}")"
  --env-var "confluence_space_key=${CONFLUENCE_SPACE_KEY:-}"
  --env-var "google_service_account_email=${GOOGLE_SERVICE_ACCOUNT_EMAIL:-}"
  --env-var "google_drive_folder_id=${GOOGLE_DRIVE_FOLDER_ID:-}"
)

declare -a ALL=(quill-anthropic-api quill-tavily-api quill-wordpress-rest-api quill-jetpack-stats-api
  quill-confluence-api quill-confluence-api-page-lifecycle quill-jira-api quill-google-drive-api quill-youtube-api)
if [[ $# -gt 0 ]]; then TARGETS=("$@"); else TARGETS=("${ALL[@]}"); fi

fail=0; summary=()
for c in "${TARGETS[@]}"; do
  extra=()
  if [[ "$c" == quill-confluence-api-page-lifecycle && -z "${CONFLUENCE_SPACE_KEY:-}" ]]; then
    summary+=("SKIP  $c (CONFLUENCE_SPACE_KEY empty)"); continue
  fi
  if [[ "$c" == quill-google-drive-api ]]; then
    if tok=$(node scripts/api-tests/mint-google-token.mjs); then extra=(--env-var "google_access_token=$tok")
    else summary+=("FAIL  $c (token mint failed)"); fail=1; continue; fi
  fi
  echo; echo "=== $c"
  # --output also writes *-executions.yaml, which records request headers/bodies (i.e. secrets); keep only the summary.
  mkdir -p "$REPORTS"
  out=()
  # --output needs `postman login`; CI is not logged in, so it falls back to the console log alone.
  if postman whoami 2>&1 | grep -q "^Logged in"; then out=(--output "$REPORTS/$c"); fi
  if postman collection run "postman/collections/$c" -e "$ENVFILE" "${ARGS[@]}" ${extra[@]+"${extra[@]}"} ${out[@]+"${out[@]}"} 2>&1 | tee "$REPORTS/$c.log"; then
    summary+=("PASS  $c")
  else
    summary+=("FAIL  $c"); fail=1
  fi
done
find "$REPORTS" -name "*.collection-run-executions.yaml" -delete 2>/dev/null  # contain request headers/bodies, i.e. secrets
echo; echo "=== Summary"; printf '%s\n' "${summary[@]}"
exit $fail
