-- Apply as the migration owner after Prisma Migrate; no passwords or LOGIN users in source.
-- Create separate LOGIN users outside Git and grant exactly one role to each.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fixit_auth_runtime') THEN
    CREATE ROLE fixit_auth_runtime NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fixit_tickets_runtime') THEN
    CREATE ROLE fixit_tickets_runtime NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA auth TO fixit_auth_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO fixit_auth_runtime;
GRANT USAGE ON SCHEMA tickets TO fixit_tickets_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tickets TO fixit_tickets_runtime;

-- New tables created by the role executing this file receive the same grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fixit_auth_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA tickets
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fixit_tickets_runtime;

-- Application credentials are provisioned separately with unique long secrets:
-- Provision LOGIN identities with unique secrets outside Git, then GRANT one runtime role.
-- Do not grant SUPERUSER, BYPASSRLS, CREATE, or migration ownership to runtime accounts.
