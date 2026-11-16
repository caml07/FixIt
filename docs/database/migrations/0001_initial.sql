-- DRAFT Contract-First schema, 15 Nov 2026.
-- PostgreSQL 16+ expected. Review and validate BEFORE committing or applying.
-- One coordinated migration owner for auth and tickets; do not auto-run per service.
BEGIN;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS tickets;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('REPORTER', 'SUPPORT_AGENT', 'ADMIN')),
  account_status text NOT NULL DEFAULT 'PENDING_PASSWORD_CHANGE'
    CHECK (account_status IN ('PENDING_PASSWORD_CHANGE', 'ACTIVE', 'DISABLED')),
  password_hash text NOT NULL, -- Argon2id PHC string, not plaintext
  temporary_expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_pending_expiry CHECK (
    (account_status = 'PENDING_PASSWORD_CHANGE' AND temporary_expires_at IS NOT NULL)
    OR (account_status <> 'PENDING_PASSWORD_CHANGE' AND temporary_expires_at IS NULL)
  )
);
CREATE UNIQUE INDEX users_email_lower_uq ON auth.users (lower(email));

CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  scope text NOT NULL CHECK (scope IN ('FULL', 'PASSWORD_CHANGE_ONLY')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT session_expiry CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_id_idx ON auth.sessions(user_id);

CREATE TABLE auth.account_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('BOOTSTRAPPED', 'CREATED', 'PASSWORD_ACTIVATED', 'PASSWORD_RESET', 'DISABLED', 'ROLE_CHANGED')),
  reason text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_audit_subject_idx ON auth.account_audit(subject_user_id, occurred_at);

CREATE TABLE tickets.categories (
  code varchar(40) PRIMARY KEY,
  label text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true
);

-- Catalogo inicial del MVP. No incluye usuarios ni datos reales.
INSERT INTO tickets.categories (code, label) VALUES
  ('NETWORK', 'Red y Wi-Fi'),
  ('HARDWARE', 'Computadoras y hardware'),
  ('SOFTWARE', 'Software'),
  ('ACCOUNTS', 'Cuentas y acceso'),
  ('PERIPHERALS', 'Perifericos');

CREATE TABLE tickets.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assignee_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  category_code varchar(40) NOT NULL REFERENCES tickets.categories(code) ON DELETE RESTRICT,
  title varchar(160) NOT NULL CHECK (length(trim(title)) > 0),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  location varchar(160),
  equipment varchar(160),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_assignment_status CHECK (
    (status = 'OPEN' AND assignee_id IS NULL)
    OR (status = 'CANCELLED' AND assignee_id IS NULL)
    OR (status IN ('ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') AND assignee_id IS NOT NULL)
  )
);
CREATE INDEX support_tickets_reporter_status_idx ON tickets.support_tickets(reporter_id, status);
CREATE INDEX support_tickets_assignee_status_idx ON tickets.support_tickets(assignee_id, status);
CREATE INDEX support_tickets_queue_idx ON tickets.support_tickets(created_at)
  WHERE status = 'OPEN' AND assignee_id IS NULL;

CREATE TABLE tickets.ticket_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets.support_tickets(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN
    ('CREATED', 'EDITED', 'CLAIMED', 'REASSIGNED', 'STATUS_CHANGED', 'PHOTO_ADDED')),
  ticket_version integer NOT NULL CHECK (ticket_version >= 1),
  from_status text,
  to_status text,
  reason text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ticket_timeline_version_uq UNIQUE(ticket_id, ticket_version)
);

CREATE TABLE tickets.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), -- eventId
  ticket_id uuid NOT NULL,
  aggregate_version integer NOT NULL CHECK (aggregate_version >= 1),
  event_type text NOT NULL CHECK (event_type IN
    ('ticket.created.v1', 'ticket.claimed.v1', 'ticket.status-changed.v1', 'ticket.reassigned.v1')),
  payload jsonb NOT NULL, -- minimal non-sensitive event body
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  CONSTRAINT outbox_timeline_fk FOREIGN KEY (ticket_id, aggregate_version)
    REFERENCES tickets.ticket_timeline(ticket_id, ticket_version) ON DELETE RESTRICT,
  CONSTRAINT outbox_event_version_uq UNIQUE(ticket_id, aggregate_version)
);
CREATE INDEX outbox_unpublished_idx ON tickets.outbox(occurred_at)
  WHERE published_at IS NULL;

CREATE TABLE tickets.ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL UNIQUE REFERENCES tickets.support_tickets(id) ON DELETE RESTRICT,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  storage_key text NOT NULL UNIQUE,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha256_hex char(64) NOT NULL CHECK (sha256_hex ~ '^[0-9a-f]{64}$'),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
