import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createAuthApp } from "../src/app.ts";
import { openAuthDatabase } from "../src/db.ts";
import { newSecret, tokenHash } from "../src/security.ts";

test("a delayed response reports an uncertain result after the account was committed", { timeout: 20000 }, async () => {
  const dbUrl = process.env.FIXIT_TEST_DB_URL;
  assert.ok(dbUrl, "a disposable PostgreSQL database is required");
  const db = openAuthDatabase(dbUrl);
  const origin = "https://fixit.example.invalid";
  let release;
  let committed;
  const committedSignal = new Promise((resolve) => { committed = resolve; });
  const continueResponse = new Promise((resolve) => { release = resolve; });
  const database = new Proxy(db, { get(target, property) {
    if (property === "$transaction") return async (...args) => {
      const result = await target.$transaction(...args);
      committed();
      await continueResponse;
      return result;
    };
    return Reflect.get(target, property);
  } });
  let server;
  try {
    const admin = await db.user.create({ data: { email: `admin-uncertain.${randomUUID()}@invalid.example`,
      displayName: "Admin test", role: "ADMIN", accountStatus: "ACTIVE", passwordHash: "unused" } });
    const token = newSecret();
    await db.session.create({ data: { userId: admin.id, tokenHash: tokenHash(token), scope: "FULL",
      expiresAt: new Date(Date.now() + 60000), lastSeenAt: new Date() } });
    server = createServer(createAuthApp({ database, publicOrigin: origin, csrfKey: randomUUID(),
      serviceTokens: [randomUUID(), randomUUID()] }));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const cookie = `__Host-fixit_session=${token}`;
    const csrf = (await (await fetch(`${base}/api/v1/auth/csrf`, { headers: { Cookie: cookie } })).json()).data.csrfToken;
    const email = `created-uncertain.${randomUUID()}@invalid.example`;
    const responsePromise = fetch(`${base}/api/v1/admin/users`, {
      method: "POST", signal: AbortSignal.timeout(9000),
      headers: { Cookie: cookie, Origin: origin, "X-CSRF-Token": csrf, "Content-Type": "application/json" },
      body: JSON.stringify({ email, displayName: "Uncertain account", role: "REPORTER" }),
    });
    await Promise.race([committedSignal, responsePromise.then(() => { throw new Error("account was not committed before response"); })]);
    const response = await responsePromise;
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.match(body.error.message, /resultado puede ser incierto/i);
    assert.equal(JSON.stringify(body).includes("temporaryPassword"), false);
    const account = await db.user.findFirstOrThrow({ where: { email } });
    assert.equal(account.accountStatus, "PENDING_PASSWORD_CHANGE");
    release();
    assert.equal((await fetch(`${base}/health`)).status, 200);
  } finally {
    release();
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.$disconnect();
  }
});
