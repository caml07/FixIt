# Tickets foundation

Use Node 24 and run npm ci, npm run build, then npm start from this directory. PORT defaults to 3002 and TICKETS_BIND_HOST defaults to 127.0.0.1. GET /health reports process liveness.

The application does not run migrations on startup. The database integration tests use a disposable PostgreSQL 17 container and the canonical migrations.

## Increment 2

Categories and authorized ticket reads use Auth session introspection and the Tickets PostgreSQL runtime role. Configure `TICKETS_DATABASE_URL`, `AUTH_INTERNAL_URL`, and `TICKETS_AUTH_SERVICE_TOKEN` in the process environment. Use synthetic data and a disposable database for local development.

When the list scope is omitted, Reporter defaults to `mine`, Support Agent to `assigned`, and Admin to `all`, as selected by Valeria. Explicit scopes remain subject to role and resource authorization.

Ticket creation validates session and role, but the real Auth handoff for session-bound CSRF verification remains unresolved. The running service therefore rejects creation rather than accepting an unverified token. Successful creation is tested with a synthetic verifier confined to the integration test. Integration with real Auth and Chat remains unverified.

The running service also rejects ticket edit, claim, status, and priority mutations until the Auth CSRF handoff is resolved. Timeline entries are written transactionally. The timeline retrieval endpoint remains deferred because the team must record the response for invalid pagination in the frozen contract before it is implemented.

## Increment 4

The Chat service uses a separate bearer credential for the internal authorization, audience, and snapshot endpoints. Configure `TICKETS_CHAT_SERVICE_TOKEN` in the Tickets process with at least 32 characters, distinct from `TICKETS_AUTH_SERVICE_TOKEN`. Keep these credentials outside the repository and expose `/internal/v1` only on the private service network.

Admin reassignment consults Auth's contracted agent-eligibility endpoint for each request, then records the reassignment, timeline and outbox together in PostgreSQL. The inspected Auth branch has not yet implemented that endpoint. The running service also lacks a coordinated CSRF verifier, so reassignment remains unavailable in the real integration. The PostgreSQL tests use synthetic Auth and Chat fixtures to exercise eligibility, concurrent version checks, rollback, audience and snapshot behavior. Eligibility can change between the Auth check and the PostgreSQL commit; that cross-service race remains to be tested with the real services.

On 27 November 2026, Node 24 lint, typecheck, build, Prisma validation and all 10 package tests passed on Windows. The integration test used disposable PostgreSQL 17 and synthetic Auth/Chat credentials, including two concurrent reassignment requests on separate connections, a forced outbox failure, former-assignee denial and paginated snapshots. Both npm audits reported zero vulnerabilities. The OpenAPI structural and migration smoke checks passed; Redocly reported five warnings. The Markdown checker failed on its existing Windows path-separator issue.

OpenAPI lists HTTP `429` for reassignment. A rate-limiting policy for that route remains pending. The real Auth–Tickets–Chat integration remains unverified. Timeline retrieval is still deferred pending the pagination contract decision described above.

## Increment 5

Set `TICKETS_ATTACHMENT_DIRECTORY` to an existing absolute directory on a private, persistent local volume. Keep it outside every web root and give filesystem access only to the Tickets service account and authorized operators. On Windows, restrict the directory ACL. An unset or inaccessible directory makes attachment storage unavailable. The service ships the local adapter and has no cloud storage configuration.

The owning Reporter can send one `file` and its ticket's current `expectedVersion` as multipart form data while the ticket is `OPEN`. Tickets checks file structure against the submitted MIME and enforces the file and ticket quotas. This validates the format and basic structure without decoding every frame or scanning for malware. Tickets bounds upload admission to four concurrent requests per process and responds with `429` when those slots are occupied. The real Auth CSRF verifier is still pending, so the running service rejects uploads. The integration tests use a session-bound synthetic verifier.

The owner, current assignee, and Admin can download through Tickets after fresh session and ticket authorization. Downloads stream from private storage with `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`. Both responses omit the private storage key and any storage URL. Uploads store a SHA-256 checksum, increment the ticket version, and write `ATTACHMENT_ADDED` in the metadata transaction. Attachments have no outbox event.

Tickets removes newly written files after a confirmed metadata rollback. A process crash, deletion failure, or an unconfirmed commit can leave a file requiring reconciliation. When Tickets logs a reconciliation diagnostic, check the reported key against committed metadata after PostgreSQL recovers. Preserve referenced files and remove an unreferenced file only after confirming the upload has finished. Back up the attachment directory alongside PostgreSQL.

Increment 5 verification used Node 24.22.3 on Windows with disposable PostgreSQL 17. All 13 package tests passed, including an observed database lock wait between competing uploads, rollback and failed-deletion diagnostics. The MP4 quota tests used synthetic container data. Install, lint, typecheck, build, Prisma validation, both npm audits, OpenAPI structural validation and the migration smoke test passed. Redocly reported the existing five warnings. npm still reported the Prisma `allowScripts` warning. The Markdown check passed in a disposable Linux container. The application CI wrapper failed to spawn npm on Windows, so its package checks were run individually. The complete Linux application runner remains unverified. No test containers or temporary fixture directories remained.

## Increment 6

The Tickets process starts an outbox worker when `TICKETS_NATS_URL` is set. It uses `TICKETS_DATABASE_URL` with a separate one-connection PostgreSQL pool. The role needs schema usage, `SELECT` on `tickets.outbox`, and `UPDATE` on its `attempts` and `published_at` columns in addition to any grants needed by the HTTP service. An unset NATS URL and token leave the worker disabled.

Set a single broker URL with no embedded credentials. Plaintext `nats://` is limited to `127.0.0.1` and `[::1]`. Use `tls://` for a non-loopback endpoint and configure trust in the broker certificate. Supply a broker token with `TICKETS_NATS_TOKEN` when required. Restrict the publisher to `fixit.ticket.*.v1` and the reply inbox it needs to receive acknowledgements. Use separate administrative credentials to provision the file-backed `FIXIT_TICKET_EVENTS` stream with limits and a duplicate window.

For a synthetic local run on Windows, start the isolated broker on loopback and provision its stream with the NATS CLI. These limits are for local development. Run the commands from the Tickets directory in PowerShell with Docker Desktop, the NATS CLI, and the local PostgreSQL environment ready.

```powershell
docker -H npipe:////./pipe/dockerDesktopLinuxEngine run -d --name fixit-tickets-dev-nats -p 127.0.0.1:4222:4222 -v fixit-tickets-dev-js:/data nats:2.14.10-alpine -js -sd /data
nats --server nats://127.0.0.1:4222 stream add FIXIT_TICKET_EVENTS --subjects "fixit.ticket.*.v1" --storage file --retention limits --max-age 1h --max-bytes 32MiB --dupe-window 2m --defaults
$env:TICKETS_NATS_URL = "nats://127.0.0.1:4222"
npm run build
npm start
```

Run `npm test` with a local Docker engine for the disposable PostgreSQL 17 and NATS fixtures. Cache the `postgres:17-alpine` image first on a new engine. The existing PostgreSQL fixture uses `--pull never`. The NATS fixture provisions the stream and a durable pull consumer named `chat-ticket-projection-v1` with a generated token and a loopback-only port.

Ticket changes, timeline entries, and outbox events still commit together in PostgreSQL. The worker uses `FOR UPDATE SKIP LOCKED` to process different tickets concurrently and keeps earlier pending events ahead of later versions for the same ticket. Connect and publish acknowledgement waits are bounded. After a broker or validation failure, the worker leaves the event pending and increments `attempts` if the database update commits. Each worker waits 500 ms initially after a failure and backs off to at most 5 seconds. Shutdown stops taking new work and gives in-flight work time to finish within the 8-second service budget. Unconfirmed work remains eligible on restart.

The worker sends the persisted `eventId` as `Nats-Msg-Id`, then marks the row published only after a valid JetStream acknowledgement. A broker acknowledgement can be lost, or the worker can exit between acknowledgement and the database update. Delivery can repeat beyond JetStream's deduplication window. Chat still needs an idempotent inbox and version reconciliation, and must continue to use live authorization. The real Chat consumer and stream-loss rebuild remain unverified. Each worker alternates priority between first attempts and retries. Retry timing is per worker and resets on restart. Invalid rows remain pending with a diagnostic and block later events for that ticket until repaired.

The approved Dependency RFC pins `@nats-io/transport-node@3.4.0` for Node TCP/TLS and authentication and `@nats-io/jetstream@3.4.0` for acknowledged delivery. The official client supplies protocol handling, publication deadlines, and message IDs. [NATS JavaScript v3.4.0](https://github.com/nats-io/nats.js/releases/tag/v3.4.0)

On 27 November 2026, all 21 tests passed on Node 24.22.3 with disposable PostgreSQL 17 and NATS 2.14.10. The broker was paused and resumed to verify automatic recovery. Tests replayed an event after a simulated lost acknowledgement with new events pending and after terminating the checked-out PostgreSQL connection. Both replays left one stored message per event within the deduplication window. The tests also checked simultaneous workers, shutdown while waiting for an acknowledgement, and all four event payloads. Install, lint, typecheck, build, Prisma validation, OpenAPI checks, the migration smoke test, and Linux Markdown checks passed. Both npm audits reported zero vulnerabilities. Redocly reported five existing warnings, and npm reported the existing Prisma `allowScripts` warning. The Windows application wrapper failed to spawn npm, so its package checks were run individually. The full Linux application runner and OS-level shutdown with the worker enabled remain unverified. The local fixture containers were removed.

## Increment 1 verification

On 27 November 2026, the owner verified `GET /health` in Postman with HTTP 200, the expected envelope and a UUID request ID. The Node 24 Windows suite passed 9 tests, including both migrations, restricted database access, shutdown behavior and simulated Docker create/start timeouts.

A clean install in a disposable Node 24.22.3 Linux container passed `npm ci`, build, Prisma schema validation and 5 HTTP tests. npm warned that the Prisma preinstall and engine postinstall scripts are not listed in `allowScripts`. Prisma validation worked in that container. The slim image also reported an OpenSSL detection warning. Prisma database migrations were not verified in that Linux image. Actual SIGINT and SIGTERM process exit behavior and the complete Linux application CI runner remain unverified. The application CI runner needs Docker for its PostgreSQL tests; the verification container had no Docker socket.

The fixture creates a uniquely named and labelled container before starting it. This gives cleanup the container ID if startup fails. If Docker creation times out before returning an ID, the fixture searches by both name and label for a bounded period. A delayed Docker operation may finish after the search.

If a test reports a Docker timeout, list possible leftovers on the local Docker Desktop engine:

```powershell
docker -H npipe:////./pipe/dockerDesktopLinuxEngine ps -a --filter label=fixit.tickets.test --format "{{.ID}} {{.Names}} {{.Labels}}"
```

Identify the exact test run by its unique `fixit-tickets-test-...` name and matching `fixit.tickets.test` label. After verifying ownership, remove only that container by ID with `docker -H npipe:////./pipe/dockerDesktopLinuxEngine rm -f <container-id>`. Check again after Docker has settled if the create operation timed out.
