# Tickets foundation

Use Node 24 and run npm ci, npm run build, then npm start from this directory. PORT defaults to 3002 and TICKETS_BIND_HOST defaults to 127.0.0.1. GET /health reports process liveness.

The application does not run migrations on startup. The database integration tests use a disposable PostgreSQL 17 container and the canonical migrations.

## Increment 2

Categories and authorized ticket reads use Auth session introspection and the Tickets PostgreSQL runtime role. Configure `TICKETS_DATABASE_URL`, `AUTH_INTERNAL_URL`, and `TICKETS_AUTH_SERVICE_TOKEN` in the process environment. Use synthetic data and a disposable database for local development.

When the list scope is omitted, Reporter defaults to `mine`, Support Agent to `assigned`, and Admin to `all`, as selected by Valeria. Explicit scopes remain subject to role and resource authorization.

Ticket creation validates session and role, but the real Auth handoff for session-bound CSRF verification remains unresolved. The running service therefore rejects creation rather than accepting an unverified token. Successful creation is tested with a synthetic verifier confined to the integration test. JetStream publishing and integration with real Auth and Chat remain unverified.

The running service also rejects ticket edit, claim, status, and priority mutations until the Auth CSRF handoff is resolved. Timeline entries are written transactionally. The timeline retrieval endpoint remains deferred because the team must record the response for invalid pagination in the frozen contract before it is implemented.

## Increment 4

The Chat service uses a separate bearer credential for the internal authorization, audience, and snapshot endpoints. Configure `TICKETS_CHAT_SERVICE_TOKEN` in the Tickets process with at least 32 characters, distinct from `TICKETS_AUTH_SERVICE_TOKEN`. Keep these credentials outside the repository and expose `/internal/v1` only on the private service network.

Admin reassignment consults Auth's contracted agent-eligibility endpoint for each request, then records the reassignment, timeline and outbox together in PostgreSQL. The inspected Auth branch has not yet implemented that endpoint. The running service also lacks a coordinated CSRF verifier, so reassignment remains unavailable in the real integration. The PostgreSQL tests use synthetic Auth and Chat fixtures to exercise eligibility, concurrent version checks, rollback, audience and snapshot behavior. Eligibility can change between the Auth check and the PostgreSQL commit; that cross-service race remains to be tested with the real services.

On 27 November 2026, Node 24 lint, typecheck, build, Prisma validation and all 10 package tests passed on Windows. The integration test used disposable PostgreSQL 17 and synthetic Auth/Chat credentials, including two concurrent reassignment requests on separate connections, a forced outbox failure, former-assignee denial and paginated snapshots. Both npm audits reported zero vulnerabilities. The OpenAPI structural and migration smoke checks passed; Redocly reported five warnings. The Markdown checker failed on its existing Windows path-separator issue.

OpenAPI lists HTTP `429` for reassignment. A rate-limiting policy for that route remains pending. JetStream publishing and the real Auth–Tickets–Chat integration remain unverified. Timeline retrieval is still deferred pending the pagination contract decision described above.

## Increment 1 verification

On 27 November 2026, the owner verified `GET /health` in Postman with HTTP 200, the expected envelope and a UUID request ID. The Node 24 Windows suite passed 9 tests, including both migrations, restricted database access, shutdown behavior and simulated Docker create/start timeouts.

A clean install in a disposable Node 24.22.3 Linux container passed `npm ci`, build, Prisma schema validation and 5 HTTP tests. npm warned that the Prisma preinstall and engine postinstall scripts are not listed in `allowScripts`. Prisma validation worked in that container. The slim image also reported an OpenSSL detection warning. Prisma database migrations were not verified in that Linux image. Actual SIGINT and SIGTERM process exit behavior and the complete Linux application CI runner remain unverified. The application CI runner needs Docker for its PostgreSQL tests; the verification container had no Docker socket.

The fixture creates a uniquely named and labelled container before starting it. This gives cleanup the container ID if startup fails. If Docker creation times out before returning an ID, the fixture searches by both name and label for a bounded period. A delayed Docker operation may finish after the search.

If a test reports a Docker timeout, list possible leftovers on the local Docker Desktop engine:

```powershell
docker -H npipe:////./pipe/dockerDesktopLinuxEngine ps -a --filter label=fixit.tickets.test --format "{{.ID}} {{.Names}} {{.Labels}}"
```

Identify the exact test run by its unique `fixit-tickets-test-...` name and matching `fixit.tickets.test` label. After verifying ownership, remove only that container by ID with `docker -H npipe:////./pipe/dockerDesktopLinuxEngine rm -f <container-id>`. Check again after Docker has settled if the create operation timed out.
