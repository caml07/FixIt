#!/bin/sh
set -eu
WEB_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
: "${FIXIT_CHAT_ROOT:?Set FIXIT_CHAT_ROOT to the Chat package directory}"
ENGINE=${CONTAINER_ENGINE:-docker}
name="fixit-ui-chat-$(openssl rand -hex 8)"
cleanup() { "$ENGINE" rm -fv "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
"$ENGINE" run -d --name "$name" -p 127.0.0.1::27017 \
  --tmpfs /data/db:rw,size=1g mongo:8.0 >/dev/null
tries=0
until "$ENGINE" exec "$name" mongosh --quiet --eval 'quit(db.runCommand({ping:1}).ok ? 0 : 1)' >/dev/null 2>&1; do
  tries=$((tries + 1)); [ "$tries" -lt 60 ] || exit 1; sleep 1
done
port=$("$ENGINE" port "$name" 27017/tcp | sed 's/.*://')
case "$port" in ''|*[!0-9]*) echo 'Invalid MongoDB port' >&2; exit 1;; esac
cd "$FIXIT_CHAT_ROOT"
FIXIT_TEST_MONGO_URL="mongodb://127.0.0.1:$port/fixit_chat" node --import tsx "$WEB_ROOT/integration/chat-browser.mjs"
