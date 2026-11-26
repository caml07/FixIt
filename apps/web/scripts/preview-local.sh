#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
root="$PWD"
chat_dir="${FIXIT_CHAT_DIR:-$root/services/chat}"
if [[ ! -f "$chat_dir/local/preview.ts" || ! -d "$chat_dir/node_modules" ]]; then
  echo "Set FIXIT_CHAT_DIR to the services/chat directory of a feat/chat checkout with npm ci completed." >&2
  exit 1
fi
name="fixit-ui-preview-$$"
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  podman rm -f "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
podman run -d --name "$name" -p 127.0.0.1::27017 docker.io/library/mongo:8.0 >/dev/null
port="$(podman port "$name" 27017 | head -1 | awk -F: '{print $NF}')"
for i in {1..60}; do
  if podman exec "$name" mongosh --quiet --eval 'quit(db.runCommand({ping:1}).ok ? 0 : 1)' >/dev/null 2>&1; then break; fi
  sleep 1
done
cd "$chat_dir"
export MONGO_URI="mongodb://127.0.0.1:$port/fixit_preview"
export CHAT_SERVICE_TOKEN="$(node -e 'console.log(crypto.randomUUID())')"
export PUBLIC_ORIGIN="http://localhost:5173"
export AUTH_URL="http://127.0.0.1:4001" TICKETS_URL="http://127.0.0.1:4001"
node --import tsx local/preview.ts &
pids+=("$!")
cd "$root/apps/web"
export FIXIT_CHAT_TARGET="http://127.0.0.1:4000"
export FIXIT_FIXTURES_TARGET="http://127.0.0.1:4001"
export FIXIT_PUBLIC_ORIGIN="$PUBLIC_ORIGIN"
node node_modules/vite/bin/vite.js --host 127.0.0.1 &
pids+=("$!")
wait -n "${pids[@]}"
