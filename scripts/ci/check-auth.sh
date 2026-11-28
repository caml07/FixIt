#!/bin/sh
# Integration test with a disposable loopback database; never uses caller DB URLs.
set -eu
cd "$(dirname "$0")/../.."
if [ -n "${CONTAINER_ENGINE:-}" ]; then ENGINE=$CONTAINER_ENGINE
elif command -v podman >/dev/null 2>&1; then ENGINE=podman
else ENGINE=docker; fi
name="fixit-ci-auth-$(openssl rand -hex 8)"
password=$(openssl rand -hex 24)
runtime_password=$(openssl rand -hex 24)
cleanup() { "$ENGINE" rm -f "$name" >/dev/null 2>&1 || true; }
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
export FIXIT_TEST_DB_URL="postgresql://fixit_ci_auth:$runtime_password@127.0.0.1:$port/postgres"
if [ "${FIXIT_AUTH_TTY_TEST:-0}" = 1 ]; then
  node --import tsx services/auth/test/admin-cli-tty.integration.test.mjs
elif [ "${FIXIT_AUTH_RECOVERY_TEST:-0}" = 1 ]; then
  export FIXIT_RECOVERY_CONTAINER="$name" FIXIT_RECOVERY_ENGINE="$ENGINE"
  node --import tsx --test services/auth/test/database-recovery.integration.test.mjs
elif [ "${FIXIT_AUTH_TICKETS_TEST:-0}" = 1 ]; then
  tickets_password=$(openssl rand -hex 24)
  "$ENGINE" exec -i "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres <<SQL
CREATE ROLE fixit_ci_tickets LOGIN PASSWORD '$tickets_password';
GRANT fixit_tickets_runtime TO fixit_ci_tickets;
SQL
  export FIXIT_TEST_TICKETS_DB_URL="postgresql://fixit_ci_tickets:$tickets_password@127.0.0.1:$port/postgres"
  node --import tsx --test services/auth/test/auth-tickets.integration.test.mjs
else
  npm run test:auth
fi
