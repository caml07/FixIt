import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import pg from "pg";
import { createAuthApp } from "../src/app.ts";
import { openAuthDatabase } from "../src/db.ts";
import { createReadinessProbe } from "../src/readiness.ts";
import { newSecret, tokenHash } from "../src/security.ts";

test("Auth documents behavior during a database pause and recovers afterward", {
  skip: process.env.FIXIT_AUTH_RECOVERY_TEST !== "1", timeout: 60000,
}, async (context) => {
  const { FIXIT_TEST_DB_URL: dbUrl, FIXIT_RECOVERY_CONTAINER: container, FIXIT_RECOVERY_ENGINE: engine } = process.env;
  assert.ok(dbUrl && engine && container && /^fixit-ci-auth-[0-9a-f]{16}$/.test(container));
  const db = openAuthDatabase(dbUrl);
  const probe = new pg.Client({ connectionString: dbUrl, query_timeout: 1000 });
  const token = newSecret();
  const serviceToken = randomUUID();
  const chatToken = randomUUID();
  let paused = false;
  let server;
  function docker(action) {
    const result = spawnSync(engine, ["container", action, container], { encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, `unable to ${action} the disposable database`);
  }
  try {
    const user = await db.user.create({ data: { email: `recovery.${randomUUID()}@invalid.example`,
      displayName: "Recovery test", role: "REPORTER", accountStatus: "ACTIVE", passwordHash: "unused" } });
    await db.session.create({ data: { userId: user.id, tokenHash: tokenHash(token), scope: "FULL",
      expiresAt: new Date(Date.now() + 60000), lastSeenAt: new Date() } });
    const admin = await db.user.create({ data: { email: `admin-recovery.${randomUUID()}@invalid.example`,
      displayName: "Admin test", role: "ADMIN", accountStatus: "ACTIVE", passwordHash: "unused" } });
    const adminToken = newSecret();
    const adminSession = await db.session.create({ data: { userId: admin.id, tokenHash: tokenHash(adminToken), scope: "FULL",
      expiresAt: new Date(Date.now() + 60000), lastSeenAt: new Date() } });
    await probe.connect();
    server = createServer(createAuthApp({ database: db, publicOrigin: "https://fixit.example.invalid",
      csrfKey: randomUUID(), serviceTokens: [serviceToken, chatToken], checkReadiness: createReadinessProbe(dbUrl) }));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const options = { headers: { Cookie: `__Host-fixit_session=${token}` } };
    const readinessOptions = { headers: { Authorization: `Bearer ${serviceToken}` }, signal: AbortSignal.timeout(5000) };
    assert.equal((await fetch(`${base}/internal/v1/auth/ready`)).status, 401);
    assert.equal((await fetch(`${base}/internal/v1/auth/ready`, { headers: { Authorization: "Bearer invalid" } })).status, 401);
    const ready = await fetch(`${base}/internal/v1/auth/ready`, readinessOptions);
    assert.equal(ready.status, 200);
    assert.equal(ready.headers.get("cache-control"), "no-store");
    assert.deepEqual((await ready.json()).data, { status: "ready" });
    assert.equal((await fetch(`${base}/internal/v1/auth/ready`, { headers: { Authorization: `Bearer ${chatToken}` } })).status, 200);
    assert.equal((await fetch(`${base}/api/v1/auth/me`, options)).status, 200);
    const adminCookie = `__Host-fixit_session=${adminToken}`;
    const adminCsrf = (await (await fetch(`${base}/api/v1/auth/csrf`, { headers: { Cookie: adminCookie } })).json()).data.csrfToken;
    const beforePause = await db.session.findUniqueOrThrow({ where: { id: adminSession.id } });
    docker("pause");
    paused = true;
    const lateWrite = probe.query("UPDATE auth.users SET display_name = $1 WHERE id = $2", ["Completed after timeout", user.id]);
    await assert.rejects(lateWrite, /timeout/i);
    const started = performance.now();
    const checks = await Promise.all(Array.from({ length: 4 }, () => fetch(`${base}/internal/v1/auth/ready`, {
      headers: { Authorization: `Bearer ${serviceToken}` }, signal: AbortSignal.timeout(5000),
    })));
    for (const result of checks) assert.equal(result.status, 503);
    assert.ok(performance.now() - started < 4500, "readiness did not finish near its three-second deadline");
    const [failed, failedMutation] = await Promise.all([
      fetch(`${base}/api/v1/auth/me`, { ...options, signal: AbortSignal.timeout(8000) }),
      fetch(`${base}/api/v1/admin/users/${user.id}/disable`, { method: "POST", signal: AbortSignal.timeout(8000),
        headers: { Cookie: adminCookie, Origin: "https://fixit.example.invalid", "X-CSRF-Token": adminCsrf } }),
    ]);
    const outage = failed.status;
    assert.equal(outage, 503, "Auth must respond with 503 when the database does not answer");
    assert.equal((await failed.json()).error.code, "SERVICE_UNAVAILABLE");
    assert.equal(failedMutation.status, 503);
    assert.match((await failedMutation.json()).error.message, /resultado puede ser incierto/i);
    context.diagnostic(`During database pause: ${outage}; /health is a liveness check only.`);
    assert.equal((await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) })).status, 200);
    docker("unpause");
    paused = false;
    let recovered = false;
    for (let attempt = 0; attempt < 5 && !recovered; attempt++) {
      try { recovered = (await fetch(`${base}/api/v1/auth/me`, { ...options, signal: AbortSignal.timeout(3000) })).status === 200; }
      catch { /* Allow a disconnected pool connection to recover on retry. */ }
      if (!recovered) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(recovered, "Auth did not recover after PostgreSQL resumed");
    const readyAgain = await fetch(`${base}/internal/v1/auth/ready`, {
      headers: { Authorization: `Bearer ${serviceToken}` }, signal: AbortSignal.timeout(5000),
    });
    assert.equal(readyAgain.status, 200);
    let delayedLookupFinished = false;
    for (let attempt = 0; attempt < 30 && !delayedLookupFinished; attempt++) {
      const current = await db.session.findUniqueOrThrow({ where: { id: adminSession.id } });
      delayedLookupFinished = current.lastSeenAt.getTime() > beforePause.lastSeenAt.getTime();
      if (!delayedLookupFinished) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(delayedLookupFinished, "delayed Admin session lookup did not complete after recovery");
    const changed = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(changed.accountStatus, "ACTIVE", "expired request must not start account deactivation after recovery");
    context.diagnostic(`Driver query_timeout experiment: write ${changed.displayName === "Completed after timeout" ? "completed after timeout" : "not observed after timeout"}.`);
  } finally {
    if (paused) docker("unpause");
    if (server) await new Promise((resolve) => server.close(resolve));
    await probe.end().catch(() => {});
    await db.$disconnect();
  }
});
