import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openAuthDatabase } from "../src/db.ts";
import { newSecret, tokenHash } from "../src/security.ts";

test("the real Auth process exposes protected readiness with PostgreSQL", { timeout: 25000 }, async () => {
  const dbUrl = process.env.FIXIT_TEST_DB_URL;
  assert.ok(dbUrl, "a disposable PostgreSQL database is required");
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const address = reservation.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));
  const ticketCredential = randomUUID();
  const db = openAuthDatabase(dbUrl);
  const environment = { ...process.env, NODE_ENV: "test", AUTH_DATABASE_URL: dbUrl, AUTH_BIND_HOST: "127.0.0.1", AUTH_PORT: String(port),
    AUTH_PUBLIC_ORIGIN: "https://fixit.example.invalid", AUTH_CSRF_KEY: randomUUID(),
    AUTH_TICKETS_SERVICE_TOKEN: ticketCredential, AUTH_CHAT_SERVICE_TOKEN: randomUUID(),
    AUTH_LOGIN_RATE_LIMIT: "2", AUTH_ADMIN_RATE_LIMIT: "3", AUTH_ACTIVATION_RATE_LIMIT: "4",
    DOTENV_CONFIG_PATH: join(tmpdir(), `fixit-no-dotenv-${randomUUID()}`) };
  delete environment.AUTH_PASSWORD_BLOCKLIST_FILE;
  const child = spawn(process.execPath, ["--import", "tsx", "services/auth/src/server.ts"], {
    windowsHide: true, stdio: "ignore", env: environment,
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 60 && !healthy; attempt++) {
      assert.equal(child.exitCode, null, "Auth process exited before becoming available");
      try { healthy = (await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) })).status === 200; }
      catch { /* The process may still be starting. */ }
      if (!healthy) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert.ok(healthy, "Auth process did not become available");
    assert.equal((await fetch(`${base}/internal/v1/auth/ready`)).status, 401);
    const ready = await fetch(`${base}/internal/v1/auth/ready`, {
      headers: { Authorization: `Bearer ${ticketCredential}` }, signal: AbortSignal.timeout(5000),
    });
    assert.equal(ready.status, 200);
    assert.deepEqual((await ready.json()).data, { status: "ready" });
    for (let attempt = 0; attempt < 3; attempt++) {
      const login = await fetch(`${base}/api/v1/auth/login`, { method: "POST",
        headers: { Origin: "https://fixit.example.invalid", "Content-Type": "application/json",
          "X-Forwarded-For": `198.51.100.${attempt + 1}` },
        body: JSON.stringify({ email: "user@invalid.example", password: randomUUID() }),
      });
      assert.equal(login.status, attempt < 2 ? 401 : 429);
    }
    const admin = await db.user.create({ data: { email: `rate-admin.${randomUUID()}@invalid.example`,
      displayName: "Rate test", role: "ADMIN", accountStatus: "ACTIVE", passwordHash: "unused" } });
    const adminToken = newSecret();
    await db.session.create({ data: { userId: admin.id, tokenHash: tokenHash(adminToken), scope: "FULL",
      expiresAt: new Date(Date.now() + 60000), lastSeenAt: new Date() } });
    const adminCookie = `__Host-fixit_session=${adminToken}`;
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`${base}/api/v1/admin/users`, { headers: { Cookie: adminCookie } });
      assert.equal(response.status, attempt < 3 ? 200 : 429);
    }
    const pending = await db.user.create({ data: { email: `rate-pending.${randomUUID()}@invalid.example`,
      displayName: "Rate test", role: "REPORTER", accountStatus: "PENDING_PASSWORD_CHANGE", passwordHash: "unused",
      temporaryExpiresAt: new Date(Date.now() + 60000) } });
    const provisionalToken = newSecret();
    await db.session.create({ data: { userId: pending.id, tokenHash: tokenHash(provisionalToken),
      scope: "PASSWORD_CHANGE_ONLY", expiresAt: new Date(Date.now() + 60000), lastSeenAt: new Date() } });
    const provisionalCookie = `__Host-fixit_session=${provisionalToken}`;
    const csrf = (await (await fetch(`${base}/api/v1/auth/csrf`, { headers: { Cookie: provisionalCookie } })).json()).data.csrfToken;
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetch(`${base}/api/v1/auth/password/activate`, { method: "POST", headers: {
        Origin: "https://fixit.example.invalid", Cookie: provisionalCookie, "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ currentPassword: "invalid", newPassword: "short" }) });
      assert.equal(response.status, attempt < 4 ? 422 : 429);
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    await db.$disconnect();
  }
});
