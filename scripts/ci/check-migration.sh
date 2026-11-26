#!/bin/sh
# Smoke-test the ordered Contract-First migrations in ephemeral PostgreSQL 17; NEVER AWS.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
INITIAL_SQL="$ROOT/docs/database/migrations/20261115000100_initial/migration.sql"
DELTA_SQL="$ROOT/docs/database/migrations/20261126000100_ticket_intake_and_evidence/migration.sql"
test -f "$INITIAL_SQL" || { echo "Missing migration: $INITIAL_SQL" >&2; exit 1; }
test -f "$DELTA_SQL" || { echo "Missing migration: $DELTA_SQL" >&2; exit 1; }

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
read_query() {
  "$ENGINE" exec "$NAME" psql -X -q -At -v ON_ERROR_STOP=1 -U postgres -d postgres -c "$1"
}

# Apply the immutable baseline, then create synthetic legacy rows before the additive migration.
"$ENGINE" exec -i "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$INITIAL_SQL"
reporter_id=$(read_query "INSERT INTO auth.users (email, display_name, role, account_status, password_hash) VALUES ('reporter@example.test', 'Reporter', 'REPORTER', 'ACTIVE', 'synthetic-hash') RETURNING id")
agent_id=$(read_query "INSERT INTO auth.users (email, display_name, role, account_status, password_hash) VALUES ('agent@example.test', 'Agent', 'SUPPORT_AGENT', 'ACTIVE', 'synthetic-hash') RETURNING id")
open_ticket_id=$(read_query "INSERT INTO tickets.support_tickets (reporter_id, category_code, title, description) VALUES ('$reporter_id', 'HARDWARE', 'Open ticket', 'Synthetic description') RETURNING id")
legacy_progress_id=$(read_query "INSERT INTO tickets.support_tickets (reporter_id, assignee_id, category_code, title, description, status) VALUES ('$reporter_id', '$agent_id', 'SOFTWARE', 'Legacy progress', 'Synthetic description', 'IN_PROGRESS') RETURNING id")
assigned_ticket_id=$(read_query "INSERT INTO tickets.support_tickets (reporter_id, assignee_id, category_code, title, description, status) VALUES ('$reporter_id', '$agent_id', 'NETWORK', 'Assigned ticket', 'Synthetic description', 'ASSIGNED') RETURNING id")

"$ENGINE" exec -i "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$DELTA_SQL"

tables=$(read_query "SELECT count(*) FROM information_schema.tables WHERE table_schema IN ('auth','tickets') AND table_type='BASE TABLE'")
fks=$(read_query "SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('auth','tickets') AND c.contype='f'")
categories=$(read_query "SELECT count(*) FROM tickets.categories")
urgency=$(read_query "SELECT reporter_urgency FROM tickets.support_tickets WHERE id='$open_ticket_id'")
open_priority=$(read_query "SELECT coalesce(effective_priority, 'NULL') FROM tickets.support_tickets WHERE id='$open_ticket_id'")
legacy_priority=$(read_query "SELECT effective_priority FROM tickets.support_tickets WHERE id='$legacy_progress_id'")
ticket_id_unique=$(read_query "SELECT count(*) FROM pg_indexes WHERE schemaname='tickets' AND tablename='ticket_attachments' AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%(ticket_id)%'")
attachment_index=$(read_query "SELECT count(*) FROM pg_indexes WHERE schemaname='tickets' AND indexname='ticket_attachments_ticket_uploaded_idx'")
echo "PostgreSQL 17 migrations: tables=$tables, FK=$fks, categories=$categories, urgency=$urgency, open_priority=$open_priority, legacy_priority=$legacy_priority"
[ "$tables" = "8" ] || { echo "Expected 8 tables" >&2; exit 1; }
[ "$fks" = "12" ] || { echo "Expected 12 foreign keys" >&2; exit 1; }
[ "$categories" = "5" ] || { echo "Expected 5 seeded IT categories" >&2; exit 1; }
[ "$urgency" = "NORMAL" ] || { echo "Existing tickets must receive neutral NORMAL urgency" >&2; exit 1; }
[ "$open_priority" = "NULL" ] || { echo "Newly migrated OPEN ticket should keep priority unset" >&2; exit 1; }
[ "$legacy_priority" = "P3_NORMAL" ] || { echo "Legacy ticket past triage must receive P3_NORMAL" >&2; exit 1; }
[ "$ticket_id_unique" = "0" ] || { echo "ticket_attachments must allow multiple rows per ticket" >&2; exit 1; }
[ "$attachment_index" = "1" ] || { echo "Missing attachment lookup index" >&2; exit 1; }

if "$ENGINE" exec "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "UPDATE tickets.support_tickets SET status='IN_PROGRESS', version=version+1 WHERE id='$assigned_ticket_id'" >/dev/null 2>&1; then
  echo "IN_PROGRESS without effective_priority unexpectedly succeeded" >&2
  exit 1
fi
"$ENGINE" exec "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "UPDATE tickets.support_tickets SET effective_priority='P2_HIGH', status='IN_PROGRESS', version=version+1 WHERE id='$assigned_ticket_id'" >/dev/null

"$ENGINE" exec "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "INSERT INTO tickets.ticket_attachments (ticket_id, uploaded_by, storage_key, content_type, size_bytes, sha256_hex) VALUES ('$open_ticket_id', '$reporter_id', 'synthetic/$open_ticket_id/image', 'image/jpeg', 5242880, repeat('a', 64)), ('$open_ticket_id', '$reporter_id', 'synthetic/$open_ticket_id/video', 'video/mp4', 26214400, repeat('b', 64))" >/dev/null
attachments=$(read_query "SELECT count(*) FROM tickets.ticket_attachments WHERE ticket_id='$open_ticket_id'")
[ "$attachments" = "2" ] || { echo "Expected multiple attachments per ticket" >&2; exit 1; }
if "$ENGINE" exec "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "INSERT INTO tickets.ticket_attachments (ticket_id, uploaded_by, storage_key, content_type, size_bytes, sha256_hex) VALUES ('$open_ticket_id', '$reporter_id', 'synthetic/$open_ticket_id/oversize', 'video/mp4', 26214401, repeat('c', 64))" >/dev/null 2>&1; then
  echo "Oversized video unexpectedly passed SQL constraint" >&2
  exit 1
fi

if "$ENGINE" exec "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "INSERT INTO tickets.ticket_timeline (ticket_id, ticket_version, actor_user_id, event_type, from_priority, to_priority) VALUES ('$assigned_ticket_id', 3, '$agent_id', 'PRIORITY_UPDATED', 'P2_HIGH', 'P3_NORMAL')" >/dev/null 2>&1; then
  echo "Priority change without a reason unexpectedly succeeded" >&2
  exit 1
fi
"$ENGINE" exec "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "UPDATE tickets.support_tickets SET effective_priority='P3_NORMAL', version=version+1 WHERE id='$assigned_ticket_id'; UPDATE tickets.support_tickets SET version=version+1 WHERE id='$open_ticket_id'" >/dev/null
"$ENGINE" exec "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "INSERT INTO tickets.ticket_timeline (ticket_id, ticket_version, actor_user_id, event_type, from_priority, to_priority, reason) VALUES ('$assigned_ticket_id', 3, '$agent_id', 'PRIORITY_UPDATED', 'P2_HIGH', 'P3_NORMAL', 'Re-evaluated after triage'), ('$open_ticket_id', 2, '$reporter_id', 'ATTACHMENT_ADDED', NULL, NULL, NULL)" >/dev/null

echo "PASS: baseline + additive migration, backfill, priority checks and attachment constraints on disposable PostgreSQL 17; not RDS."
