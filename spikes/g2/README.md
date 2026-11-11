# G2 benchmark — isolated vertical-slice spike

**Status:** experimental tooling, NOT the FixIt application, a production auth implementation, or G2 approval. Keep this tree separate from `services/`.

This spike runs *working* Express services with bcryptjs, PostgreSQL transactions,
MongoDB persistence, Socket.IO and durable NATS JetStream events. It compares:

- `three`: Auth + Tickets + Chat in separate Node runtimes.
- `two`: Auth + Tickets in a combined Core runtime; Chat still independent.

Both run PostgreSQL 17, MongoDB 8, NATS 2.12 and Caddy 2, on a private rootless Podman network. Only Caddy is published to a random **127.0.0.1** port. No AWS credentials, production data, permanent volumes or fixed passwords.

## Reproduce

Requirements: Node.js 26+, npm, rootless Podman with cgroups v2, curl, and free local resources.

```sh
npm ci --prefix spikes/g2
npm run check --prefix spikes/g2
sh spikes/g2/run.sh three
sh spikes/g2/run.sh two
python3 spikes/g2/analyze.py
```

### CPU tuning without changing the product

The initial benchmark imposed separate tiny CPU quotas on Auth and Tickets.
This is useful as a stress test, **not** a reason by itself to reject a
three-service design. The runner now supports additional CPU profiles:

```sh
# Same *total* 2-vCPU quota as baseline, reallocated among containers:
G2_BCRYPT_ENGINE=native G2_BCRYPT_COST=11 sh spikes/g2/run.sh three balanced

# All containers share the same two laptop physical cores (0 and 2):
G2_BCRYPT_ENGINE=native G2_BCRYPT_COST=11 sh spikes/g2/run.sh three shared2
G2_BCRYPT_ENGINE=native G2_BCRYPT_COST=11 sh spikes/g2/run.sh two shared2

# Larger 4-core local experiment: NOT a 2-vCPU EC2 simulation.
G2_BCRYPT_ENGINE=native G2_BCRYPT_COST=10 sh spikes/g2/run.sh three shared4

# Rebuild the tuning-only comparison:
python3 spikes/g2/analyze-tuning.py
```

### Resilience + 10 concurrent sockets (separate from the earlier benchmarks)

Run the bounded workload with ten real Socket.IO connections, one message
per user per second, and then inject service/broker/storage outages:

```sh
G2_SUITE=resilience G2_BCRYPT_ENGINE=native G2_BCRYPT_COST=11 G2_SOAK_SECONDS=20 sh spikes/g2/run.sh three shared2
G2_SUITE=resilience G2_BCRYPT_ENGINE=native G2_BCRYPT_COST=11 G2_SOAK_SECONDS=20 sh spikes/g2/run.sh two shared2
python3 spikes/g2/analyze-resilience.py
```

Raw results and sampled container memory live under
`spikes/g2/results/resilience/` with a [comparison summary](results/resilience/SUMMARY.md).
The results from the first 25-second runs combine normal-load timings and
failure-injection timings; they are preserved but **must not be used** as
normal-operation p95/p99 comparisons. Corrected runs with the
`soakSuccessfulSends` field freeze the successful workload sample
**before** stopping services. The suite does not count dropped messages
as successes; each socket ACK must correspond to a persisted MongoDB message.

Failures are tested in sequence: Auth (three-service topology only),
Tickets/Core, MongoDB, PostgreSQL and NATS. New messages must not succeed
if their session/permission or persistence cannot be checked, and events
created while NATS is down must drain from the PostgreSQL outbox after
reconnection. The test restarts **the same container** with its existing
data, so this is *not* a proof of backup/restore, lost disks or HA.
The 20-25 second workload is a **short smoke/soak**, not sustained
multi-hour reliability testing. Shared physical laptop cores are not
an EC2 t3.medium CPU-credit simulation.

### G3 — revoke a session while its Socket.IO connection stays open

Run the **negative security regression** against both temporary topologies:

```sh
G2_SUITE=g3 G2_BCRYPT_ENGINE=native G2_BCRYPT_COST=11 sh spikes/g2/run.sh three shared2
G2_SUITE=g3 G2_BCRYPT_ENGINE=native G2_BCRYPT_COST=11 sh spikes/g2/run.sh two shared2
```

The `g3-security.mjs` suite tests the **public** Auth, Tickets and Chat
interfaces: a stranger cannot join/read a ticket; a legitimate recipient
receives a message; `POST /api/auth/logout` revokes its opaque session;
the old socket can neither send **nor receive** further private messages;
and a reassigned agent loses both message access and broadcast delivery.
The test originally reproduced a real defect in this spike: the server
kept broadcasting to a socket whose cached handshake identity had a
revoked session. It now **revalidates session + ticket access per recipient**
and removes stale subscriptions. That adds calls to Tickets/Auth and will
need a new G2 performance measurement before deployment.

Results are in `results/g3/`. See
[`docs/012.G3-Security-Consistency.md`](../../docs/012.G3-Security-Consistency.md)
for what was exercised and which production-level safeguards remain
**unimplemented** (TLS/WSS, CSRF, Origin allowlist, rate limiting, cookie
policies, in-flight races and secure password recovery). **Never ship this
test server as the production FixIt backend.**

Supported profiles: `legacy` (original 1.95 vCPU fixed quotas),
`balanced` (2 vCPU distributed as fixed quotas),
`expanded` (4 vCPU distributed as fixed quotas),
`shared2` (all processes on cores `0,2`, without fractional quotas),
`shared4` (all processes on cores `0,1,2,3`).
The default remains `legacy` for reproducing old results.
Shared profiles require a machine with those CPU IDs and cgroups v2; check
`lscpu -e=CPU,CORE` and override via `G2_CPUSET_2`/`G2_CPUSET_4`.
These are **physical cores on this laptop**, not EC2 virtual CPU equivalents;
host contention and T3 CPU credits are not modeled.

Native `bcrypt` runs CPU-intensive work outside the JS event loop through
libuv workers. `bcryptjs` is pure JavaScript and yields cooperatively,
so changing the implementation can affect both throughput and CPU contention.
Both use the bcrypt algorithm; changing the cost changes work factor, not just
speed. **Cost 11 here is a candidate, never a prescribed production setting**;
calibrate on the actual deployment with a password-policy and security review.

Each tuning JSON records `bcryptEngine`, `bcryptCost`, `profile`,
and separate timing cohorts for *three individual warm logins* and *ten
simultaneous logins*. Older tuning runs used the `login` key for 12 logins
(ten simultaneous plus two later); the analyzer labels this caveat and does
not treat the two cohorts as identical. Results stay under
`spikes/g2/results/tuning/`, separate from the original baseline.

The script launches transient containers with independent cgroups, collects
`podman stats` snapshots, runs `bench.mjs`, and cleans up its **own**
containers and network on exit. Container images remain cached. No Compose
provider is required. Use `podman ps` and `podman network ls` to verify cleanup.

Results are in `spikes/g2/results/g2-<mode>-<UTC>.json`, with matching
`-stats.tsv` and `-run.log` files. The logs are from this test only,
not production, and contain no generated credentials.

## Workload and what it proves

- Ten fixture users (7 reporters, 2 support agents, 1 admin) perform real
  bcrypt logins with **cost 9**; this is *not* a calibrated production cost.
- Admin creates a test account; restricted first login cannot access Tickets;
  password is changed and a full session is obtained.
- Seven ticket creations each commit ticket + timeline + outbox in PostgreSQL.
- Two agents race to claim the same ticket: exactly one success and one 409.
- Reporters and their current agent write 23 persisted messages across tickets,
  retrieve histories and verify Mongo deduplication by `clientMessageId`.
- One real Socket.IO WebSocket connection joins and sends a persisted message.
- Ten authenticated users issue 60 overlapping `/auth/me` HTTP requests.
- An admin reassigns one ticket; a former agent is rejected, the new one gains access.
- Chat is stopped; Tickets continues writing events; the same Chat container
  restarts and its durable JetStream consumer catches up; Mongo history survives.
- The outbox pending count reaches zero; event projection count reconciles.

The workload is **not a production benchmark**. It has small sample sizes,
only one WebSocket client, a limited ticket state machine, synthetic user data,
no sustained multi-hour load, no automatic backup/restore, and no real AWS host
or baseline host-memory budget. Authentication runs over loopback HTTP for the
test, with no CSRF/TLS or production-grade rate limiting. Passwords and service
secrets are ephemeral; internal endpoints and the fixture admin-only route
MUST NOT be copied to production. The npm `nats` package used for this isolated
spike is deprecated in favor of the newer `@nats-io/*` packages.
Database credentials are shared in the spike, and MongoDB/NATS are not
configured with application authentication. Those shortcuts are acceptable only
inside its isolated disposable network, not in the accepted FixIt design.

**Fairness caveat:** Both configurations have the same total cap
of **2,510 MiB / 1.95 vCPU** across the runtime containers, but CPU quota
distribution differs: in `three`, Auth has 0.20 and Tickets 0.30 vCPU;
in `two`, Core has a combined 0.50 vCPU. Workloads running on a shared laptop
can be affected by host contention and filesystem cache. Report all runs,
never interpret one small-sample p95 difference as a universal property
of the architecture.

For G2 PASS, benchmark the actual FixIt code with production-calibrated bcrypt,
proxy/TLS and full protocol, simultaneous Socket.IO clients, failure/restore,
CPU throttling/OOM measurements, and an explicitly authorized AWS budget.
This spike informs the decision but **does not accept ADR-005 or any gate**.
