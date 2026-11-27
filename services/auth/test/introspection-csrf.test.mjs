import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createAuthApp } from "../src/app.ts";
import { newSecret, tokenHash } from "../src/security.ts";

test("introspection verifies CSRF against the same active FULL session", async () => {
  const ticketsToken = randomUUID();
  const sessionToken = newSecret();
  const otherToken = newSecret();
  const sessions = new Map();
  for (const token of [sessionToken, otherToken]) {
    const hash = tokenHash(token);
    sessions.set(hash, { id: randomUUID(), tokenHash: hash, scope: "FULL", revokedAt: null,
      createdAt: new Date(), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 60000),
      user: { id: randomUUID(), role: "REPORTER", accountStatus: "ACTIVE" } });
  }
  const database = { session: {
    findUnique: async ({ where }) => sessions.get(where.tokenHash) ?? null,
    updateMany: async () => ({ count: 1 }),
  } };
  const server = createServer(createAuthApp({ database, publicOrigin: "https://fixit.example.invalid",
    csrfKey: "synthetic-csrf-key-for-tests-0000000000",
    serviceTokens: [ticketsToken, "synthetic-chat-service-token-000000000000"] }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  async function getCsrf(token) {
    const response = await fetch(`${base}/api/v1/auth/csrf`, {
      headers: { Cookie: `__Host-fixit_session=${token}` },
    });
    assert.equal(response.status, 200);
    return (await response.json()).data.csrfToken;
  }
  async function introspect(body, bearer = ticketsToken) {
    const response = await fetch(`${base}/internal/v1/sessions/introspect`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
      body: JSON.stringify(body),
    });
    return { response, body: await response.json() };
  }
  try {
    const csrf = await getCsrf(sessionToken);
    const otherCsrf = await getCsrf(otherToken);
    const good = await introspect({ sessionToken, csrfToken: csrf });
    assert.equal(good.response.status, 200);
    assert.equal(good.response.headers.get("cache-control"), "no-store");
    assert.equal(good.body.data.active, true);
    assert.equal(good.body.data.csrfValid, true);
    for (const bad of ["", "invalid", otherCsrf]) {
      const result = await introspect({ sessionToken, csrfToken: bad });
      assert.equal(result.body.data.active, true);
      assert.equal(result.body.data.csrfValid, false);
    }
    const read = await introspect({ sessionToken });
    assert.equal(read.body.data.active, true);
    assert.equal(Object.hasOwn(read.body.data, "csrfValid"), false);
    assert.deepEqual((await introspect({ sessionToken: newSecret(), csrfToken: csrf })).body.data,
      { active: false, csrfValid: false });
    sessions.get(tokenHash(sessionToken)).expiresAt = new Date(Date.now() - 1000);
    assert.deepEqual((await introspect({ sessionToken, csrfToken: csrf })).body.data,
      { active: false, csrfValid: false });
    sessions.get(tokenHash(sessionToken)).expiresAt = new Date(Date.now() + 60000);
    sessions.get(tokenHash(sessionToken)).user.accountStatus = "DISABLED";
    assert.deepEqual((await introspect({ sessionToken, csrfToken: csrf })).body.data,
      { active: false, csrfValid: false });
    sessions.get(tokenHash(sessionToken)).user.accountStatus = "ACTIVE";
    sessions.get(tokenHash(sessionToken)).revokedAt = new Date();
    assert.deepEqual((await introspect({ sessionToken, csrfToken: csrf })).body.data,
      { active: false, csrfValid: false });
    sessions.get(tokenHash(otherToken)).scope = "PASSWORD_CHANGE_ONLY";
    assert.deepEqual((await introspect({ sessionToken: otherToken, csrfToken: otherCsrf })).body.data,
      { active: false, csrfValid: false });
    assert.equal((await introspect({ sessionToken, csrfToken: 42 })).response.status, 422);
    assert.equal((await introspect({ sessionToken }, "invalid")).response.status, 401);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
