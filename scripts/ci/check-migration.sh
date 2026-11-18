#!/bin/sh
# Smoke-test committed initial SQL in ephemeral PostgreSQL 17; NEVER AWS.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
SQL="$ROOT/docs/database/migrations/20261115000100_initial/migration.sql"
test -f "$SQL" || { echo "Missing migration: $SQL" >&2; exit 1; }

if [ -n "${CONTAINER_ENGINE:-}" ]; then
  ENGINE="$CONTAINER_ENGINE"
elif command -v podman >/dev/null 2>&1; then
  ENGINE=podman
elif command -v docker >/dev/null 2>&1; then
  ENGINE=docker
else
  echo "No Podman/Docker available: migration smoke test NOT RUN." >&2
  exit 1
fi

NAME="fixit-ci-pg-$$"
cleanup() { "$ENGINE" rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT HUP INT TERM

# No network, isolated temporary filesystem and no real secrets.
"$ENGINE" run -d --name "$NAME" --network none \
  --tmpfs /var/lib/postgresql/data:rw,size=256m \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:17-alpine >/dev/null

tries=0
until "$ENGINE" exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -gt 40 ]; then
    echo "PostgreSQL failed readiness" >&2
    "$ENGINE" logs "$NAME" >&2 || true
    exit 1
  fi
  sleep 1
done
"$ENGINE" exec -i "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$SQL"
read_query() {
  "$ENGINE" exec "$NAME" psql -X -At -v ON_ERROR_STOP=1 -U postgres -d postgres -c "$1"
}
tables=$(read_query "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('auth','tickets') AND table_type='BASE TABLE'")
fks=$(read_query "SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('auth','tickets') AND c.contype='f'")
categories=$(read_query "SELECT count(*) FROM tickets.categories")
echo "PostgreSQL 17 migration: tables=$tables, FK=$fks, categories=$categories"
[ "$tables" = "8" ] || { echo "Expected 8 tables" >&2; exit 1; }
[ "$fks" = "12" ] || { echo "Expected 12 foreign keys" >&2; exit 1; }
[ "$categories" = "5" ] || { echo "Expected 5 seeded IT categories" >&2; exit 1; }
echo "PASS: SQL smoke test on disposable PostgreSQL, not RDS."
