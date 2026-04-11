#!/bin/bash
set -euo pipefail

# Upload help videos to Supabase Storage
# Usage: bash demo-video/employee-help/upload.sh [--production]
#
# Requires:
#   SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars
#   Or use --production to use production values from .env.local

DIR="$(cd "$(dirname "$0")" && pwd)"
VIDEOS_DIR="$DIR/output"
BUCKET="help-videos"

# Default to local Supabase
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

# Check for --production flag
if [[ "${1:-}" == "--production" ]]; then
  ROOT_DIR="$(cd "$DIR/../.." && pwd)"
  if [[ -f "$ROOT_DIR/.env.local" ]]; then
    set -a
    source "$ROOT_DIR/.env.local"
    set +a
  fi
  SUPABASE_URL="${VITE_SUPABASE_URL:-${SUPABASE_URL}}"
  SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"
fi

if [[ -z "$SERVICE_KEY" ]]; then
  echo "Error: SUPABASE_SERVICE_ROLE_KEY is required."
  echo "Set it as an env var or ensure it's in .env.local"
  exit 1
fi

echo "=== Uploading help videos to Supabase Storage ==="
echo "  URL: $SUPABASE_URL"
echo "  Bucket: $BUCKET"
echo ""

VIDEOS=(welcome clock schedule pay timecard tips shifts requests)

for video in "${VIDEOS[@]}"; do
  FILE="$VIDEOS_DIR/${video}.mp4"
  if [[ ! -f "$FILE" ]]; then
    echo "  SKIP: ${video}.mp4 (not found)"
    continue
  fi

  SIZE=$(du -h "$FILE" | cut -f1)
  echo -n "  Uploading ${video}.mp4 (${SIZE})... "

  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${video}.mp4" \
    -H "Authorization: Bearer ${SERVICE_KEY}" \
    -H "Content-Type: video/mp4" \
    -H "x-upsert: true" \
    --data-binary "@${FILE}")

  if [[ "$HTTP_CODE" == "200" ]]; then
    echo "OK"
  else
    echo "FAILED (HTTP $HTTP_CODE)"
    # Show error details
    curl -s \
      -X POST \
      "${SUPABASE_URL}/storage/v1/object/${BUCKET}/${video}.mp4" \
      -H "Authorization: Bearer ${SERVICE_KEY}" \
      -H "Content-Type: video/mp4" \
      -H "x-upsert: true" \
      --data-binary "@${FILE}" | head -200
    echo ""
  fi
done

echo ""
echo "=== Done ==="
echo "Videos accessible at: ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/<name>.mp4"
