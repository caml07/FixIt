import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import argon2 from "argon2";
import { createAuthApp } from "../src/app.ts";
import { openAuthDatabase } from "../src/db.ts";
import { tokenHash } from "../src/security.ts";

test("logout and disable reject session checks paused after their initial lookup", { timeout: 30000 }, async () => {
  const dbUrl = process.env.FIXIT_TEST_DB_URL;
  assert.ok(dbUrl, "a disposable PostgreSQL database is required");
  const db = openAuthDatabase(dbUrl);
  const origin = "https://fixit.example.invalid";
  const serviceToken = randomUUID();
  const password = randomBytes(32).toString("base64url");
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  let gate;
  let loginGate;
  const sessions = new Proxy(db.session, { get(target, property) {
    if (property === "findUnique") return async (...args) => {
      const result = await target.findUnique(...args);
      if (gate?.armed && args[0].where.tokenHash === gate.hash) {
        const current = gate;
        current.armed = false;
        current.reached();
        await current.continue;
      }
      return result;
    };
    return Reflect.get(target, property);
  } });
  const users = new Proxy(db.user, { get(target, property) {
    if (property === "findFirst") return async (...args) => {
      const result = await target.findFirst(...args);
      if (loginGate?.armed && result?.email === loginGate.email) {
        const current = loginGate;
        current.armed = false;
        current.reached();
        await current.continue;
      }
      return result;
    };
    return Reflect.get(target, property);
  } });
  const database = new Proxy(db, { get(target, property) {
    if (property === "session") return sessions;
    if (property === "user") return users;
    return Reflect.get(target, property);
  } });
  let server;
  function pauseLookup(token) {
    let reached;
    let resume;
    const arrived = new Promise((resolve) => { reached = resolve; });
    const continuation = new Promise((resolve) => { resume = resolve; });
    gate = { hash: tokenHash(token), armed: true, reached, continue: continuation, resume };
    return { arrived, resume };
  }
  try {
    const adminEmail = `admin-race.${randomUUID()}@invalid.example`;
    const firstEmail = `logout-race.${randomUUID()}@invalid.example`;
    const secondEmail = `disable-race.${randomUUID()}@invalid.example`;
    const thirdEmail = `login-race.${randomUUID()}@invalid.example`;
    for (const [email, role] of [[adminEmail, "ADMIN"], [firstEmail, "REPORTER"], [secondEmail, "REPORTER"], [thirdEmail, "REPORTER"]]) {
      await db.user.create({ data: { email, role, displayName: "Race test", accountStatus: "ACTIVE", passwordHash } });
    }
    const secondUser = await db.user.findFirstOrThrow({ where: { email: secondEmail } });
    const thirdUser = await db.user.findFirstOrThrow({ where: { email: thirdEmail } });
    server = createServer(createAuthApp({ database, publicOrigin: origin, csrfKey: randomUUID(),
      serviceTokens: [serviceToken, randomUUID()] }));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    async function login(email) {
      const response = await fetch(`${base}/api/v1/auth/login`, { method: "POST",
        headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      assert.equal(response.status, 200);
      const cookie = response.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie);
      return cookie;
    }
    async function csrf(cookie) {
      const response = await fetch(`${base}/api/v1/auth/csrf`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      return (await response.json()).data.csrfToken;
    }
    const adminCookie = await login(adminEmail);
    const adminCsrf = await csrf(adminCookie);
    const firstCookie = await login(firstEmail);
    const firstCsrf = await csrf(firstCookie);
    const firstGate = pauseLookup(firstCookie.split("=")[1]);
    const pendingMe = fetch(`${base}/api/v1/auth/me`, { headers: { Cookie: firstCookie } });
    await firstGate.arrived;
    const logout = await fetch(`${base}/api/v1/auth/logout`, { method: "POST", headers: {
      Cookie: firstCookie, Origin: origin, "X-CSRF-Token": firstCsrf } });
    assert.equal(logout.status, 204);
    firstGate.resume();
    assert.equal((await pendingMe).status, 401);

    const secondCookie = await login(secondEmail);
    const secondToken = secondCookie.split("=")[1];
    const secondGate = pauseLookup(secondToken);
    const pendingIntrospection = fetch(`${base}/internal/v1/sessions/introspect`, { method: "POST", headers: {
      Authorization: `Bearer ${serviceToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sessionToken: secondToken }) });
    await secondGate.arrived;
    const disable = await fetch(`${base}/api/v1/admin/users/${secondUser.id}/disable`, { method: "POST", headers: {
      Cookie: adminCookie, Origin: origin, "X-CSRF-Token": adminCsrf } });
    assert.equal(disable.status, 204);
    secondGate.resume();
    const introspection = await pendingIntrospection;
    assert.equal(introspection.status, 200);
    assert.deepEqual((await introspection.json()).data, { active: false });
    assert.equal((await fetch(`${base}/api/v1/auth/me`, { headers: { Cookie: secondCookie } })).status, 401);

    let loginReached;
    let resumeLogin;
    const loginArrived = new Promise((resolve) => { loginReached = resolve; });
    const loginContinue = new Promise((resolve) => { resumeLogin = resolve; });
    loginGate = { email: thirdEmail, armed: true, reached: loginReached, continue: loginContinue, resume: resumeLogin };
    const pendingLogin = fetch(`${base}/api/v1/auth/login`, { method: "POST", headers: {
      Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email: thirdEmail, password }) });
    await loginArrived;
    const disabledDuringLogin = await fetch(`${base}/api/v1/admin/users/${thirdUser.id}/disable`, { method: "POST", headers: {
      Cookie: adminCookie, Origin: origin, "X-CSRF-Token": adminCsrf } });
    assert.equal(disabledDuringLogin.status, 204);
    resumeLogin();
    const staleLogin = await pendingLogin;
    assert.equal(staleLogin.status, 401);
    assert.equal(staleLogin.headers.get("set-cookie"), null);
  } finally {
    gate?.resume();
    loginGate?.resume();
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.$disconnect();
  }
});
