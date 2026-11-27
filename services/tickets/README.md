# Tickets foundation

Use Node 24 and run npm ci, npm run build, then npm start from this directory. PORT defaults to 3002 and TICKETS_BIND_HOST defaults to 127.0.0.1. GET /health reports process liveness.

The application does not run migrations on startup. The database integration tests use a disposable PostgreSQL 17 container and the canonical migrations.

## Increment 2

Categories and authorized ticket reads use Auth session introspection and the Tickets PostgreSQL runtime role. Configure `TICKETS_DATABASE_URL`, `AUTH_INTERNAL_URL`, and `TICKETS_AUTH_SERVICE_TOKEN` in the process environment. Use synthetic data and a disposable database for local development.

When the list scope is omitted, Reporter defaults to `mine`, Support Agent to `assigned`, and Admin to `all`, as selected by Valeria. Explicit scopes remain subject to role and resource authorization.

Ticket creation validates session and role, but the real Auth handoff for session-bound CSRF verification remains unresolved. The running service therefore rejects creation rather than accepting an unverified token. Successful creation is tested with a synthetic verifier confined to the integration test. JetStream publishing and integration with real Auth and Chat remain unverified.

The running service also rejects ticket edit, claim, status, and priority mutations until the Auth CSRF handoff is resolved. Timeline entries are written transactionally. The timeline retrieval endpoint remains deferred because the team must record the response for invalid pagination in the frozen contract before it is implemented.

## Increment 1 verification

On 27 November 2026, the owner verified `GET /health` in Postman with HTTP 200, the expected envelope and a UUID request ID. The Node 24 Windows suite passed 9 tests, including both migrations, restricted database access, shutdown behavior and simulated Docker create/start timeouts.

A clean install in a disposable Node 24.22.3 Linux container passed `npm ci`, build, Prisma schema validation and 5 HTTP tests. npm warned that the Prisma preinstall and engine postinstall scripts are not listed in `allowScripts`. Prisma validation worked in that container. The slim image also reported an OpenSSL detection warning. Prisma database migrations were not verified in that Linux image. Actual SIGINT and SIGTERM process exit behavior and the complete Linux application CI runner remain unverified. The application CI runner needs Docker for its PostgreSQL tests; the verification container had no Docker socket.

The fixture creates a uniquely named and labelled container before starting it. This gives cleanup the container ID if startup fails. If Docker creation times out before returning an ID, the fixture searches by both name and label for a bounded period. A delayed Docker operation may finish after the search.

If a test reports a Docker timeout, list possible leftovers on the local Docker Desktop engine:

```powershell
docker -H npipe:////./pipe/dockerDesktopLinuxEngine ps -a --filter label=fixit.tickets.test --format "{{.ID}} {{.Names}} {{.Labels}}"
```

Identify the exact test run by its unique `fixit-tickets-test-...` name and matching `fixit.tickets.test` label. After verifying ownership, remove only that container by ID with `docker -H npipe:////./pipe/dockerDesktopLinuxEngine rm -f <container-id>`. Check again after Docker has settled if the create operation timed out.
