#!/bin/sh
# Integration test with a disposable loopback database; never uses caller DB URLs.
set -eu
CHAT_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
: "${FIXIT_AUTH_ROOT:?Set FIXIT_AUTH_ROOT to the Auth checkout}"
cd "$FIXIT_AUTH_ROOT"
if [ -n "${CONTAINER_ENGINE:-}" ]; then ENGINE=$CONTAINER_ENGINE
elif command -v podman >/dev/null 2>&1; then ENGINE=podman
else ENGINE=docker; fi
name="fixit-ci-auth-$(openssl rand -hex 8)"
password=$(openssl rand -hex 24)
runtime_password=$(openssl rand -hex 24)
mongo="fixit-ci-chat-$(openssl rand -hex 8)"
cleanup() { "$ENGINE" rm -fv "$name" "$mongo" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
"$ENGINE" run -d --name "$name" -p 127.0.0.1::5432 \
  --tmpfs /var/lib/postgresql/data:rw,size=256m \
  -e POSTGRES_PASSWORD="$password" docker.io/library/postgres:17-alpine >/dev/null
tries=0
until "$ENGINE" exec "$name" pg_isready -U postgres >/dev/null 2>&1; do
  tries=$((tries + 1)); [ "$tries" -lt 40 ] || exit 1; sleep 1
done
port=$("$ENGINE" port "$name" 5432/tcp | sed 's/.*://')
case "$port" in ''|*[!0-9]*) echo 'Invalid disposable DB port' >&2; exit 1;; esac
export DATABASE_URL="postgresql://postgres:$password@127.0.0.1:$port/postgres"
npm run db:generate
npm run db:migrate
"$ENGINE" exec -i "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres < ops/postgres/runtime-roles.sql
"$ENGINE" exec -i "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres <<SQL
CREATE ROLE fixit_ci_auth LOGIN PASSWORD '$runtime_password';
GRANT fixit_auth_runtime TO fixit_ci_auth;
SQL
"$ENGINE" run -d --name "$mongo" -p 127.0.0.1::27017 --tmpfs /data/db:rw,size=1g mongo:8.0 >/dev/null
tries=0
until "$ENGINE" exec "$mongo" mongosh --quiet --eval 'quit(db.runCommand({ping:1}).ok ? 0 : 1)' >/dev/null 2>&1; do
  tries=$((tries + 1)); [ "$tries" -lt 60 ] || exit 1; sleep 1
done
mongoport=$("$ENGINE" port "$mongo" 27017/tcp | sed 's/.*://')
case "$mongoport" in ''|*[!0-9]*) echo 'Invalid Mongo port' >&2; exit 1;; esac
FIXIT_TEST_DB_URL="postgresql://fixit_ci_auth:$runtime_password@127.0.0.1:$port/postgres" FIXIT_TEST_MONGO_URL="mongodb://127.0.0.1:$mongoport/fixit_chat" node --import tsx "$CHAT_ROOT/integration/auth-chat.mjs"
