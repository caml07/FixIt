# FixIt — agent guardrails (COP3851)

**Canonical project rules:** read [CONTEXT.md](CONTEXT.md) and [docs/000.INDEX.md](docs/000.INDEX.md) before changing the project. This short bridge exists because COP3851 requires a root `CLAUDE.md` or `GEMINI.md`. Keep the substantive decisions in `CONTEXT.md`.

1. **Contract First:** do not generate backend controllers until `docs/openapi.json`, the 3NF PostgreSQL schema and FK migrations have been validated **and committed beforehand**. These are still drafts. Controllers must match OpenAPI paths, methods, parameters, authentication, request/response bodies and status codes.
2. **Authorization:** enforce authentication, RBAC and per-resource ownership/assignment on every protected operation, including listings, message history and WebSocket broadcasts. Never trust user-supplied owner IDs. **FixIt is single-tenant for Keiser University LAC (academic pilot). Do not add `tenant_id`** unless the professor explicitly requires it. Authorize resources by authenticated `reporter_id`, current `assignee_id`, `ADMIN` role and ticket status.
3. **Database access:** parameterized SQL or ORM bindings only; never concatenate untrusted input into SQL. PostgreSQL FK, status transitions, timeline and outbox must preserve transactions. Validate MongoDB operators/types against NoSQL injection.
4. **Sessions:** validate opaque sessions in Auth; revocation/expiry must fail closed. Public cookies are `HttpOnly; Secure; SameSite=Strict`; protect cross-origin requests with CSRF and Origin checks. Lock CORS to the actual HTTPS hostname. Never publish `/internal/v1` or DB/broker ports.
5. **Security and dependencies:** do not log or commit secrets. Before adding backend dependencies, record a `[DEPENDENCY RFC]`, pin versions and run/report the actual `npm audit` result. Plan negative tests for BOLA/IDOR, injection, CORS credentials and rate-limit bypass.
6. **Evidence and control:** distinguish design proposals, historical spikes and tests executed on the product. Do not mark gates `PASS` without reproducible evidence. **Never commit, merge, push, provision AWS, or incur costs without the user's explicit authorization.**

Reference documents: [G1 contracts](docs/010.G1-Contracts.md), [Gates](docs/011.Gates.md), [Cloud design](docs/004.Cloud.md), [COP3851 spec](docs/references/COP3851_Capstone_2026-11-11.md).
