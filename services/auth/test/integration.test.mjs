import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import argon2 from "argon2";
import { createAuthApp } from "../src/app.ts";
import { openAuthDatabase } from "../src/db.ts";
import { tokenHash } from "../src/security.ts";

const dbUrl = process.env.FIXIT_TEST_DB_URL;
const origin = "https://fixit.example.invalid";
const serviceTokenA = "tickets-synthetic-token-for-integration-only-0001";
const serviceTokenB = "chat-synthetic-token-for-integration-only-0002";
const csrfKey = "csrf-key-synthetic-for-integration-only-0003";

test("G4 Auth: real PostgreSQL sessions, CSRF, Admin lifecycle and revocation", async () => {
  assert.ok(dbUrl, "FIXIT_TEST_DB_URL must point to a disposable PostgreSQL test database.");
  const db = openAuthDatabase(dbUrl);
  await db.$connect();
  const adminPassword = randomBytes(32).toString("base64url");
  const adminHash = await argon2.hash(adminPassword, {
    type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
  });
  const admin = await db.user.create({
    data: {
      email: "admin." + randomUUID() + "@invalid.example",
      displayName: "Test Admin",
      role: "ADMIN",
      accountStatus: "ACTIVE",
      passwordHash: adminHash,
    },
  });
  let pauseLoginLookup;
  const users = new Proxy(db.user, {
    get(target, property) {
      if (property === "findFirst") return async (...args) => {
        const result = await target.findFirst(...args);
        if (pauseLoginLookup) await pauseLoginLookup();
        return result;
      };
      return Reflect.get(target, property);
    },
  });
  const database = new Proxy(db, {
    get(target, property) {
      return property === "user" ? users : Reflect.get(target, property);
    },
  });
  const app = createAuthApp({
    database, publicOrigin: origin,
    csrfKey, serviceTokens: [serviceTokenA, serviceTokenB],
    passwordBlocklist: new Set(["blocked integration password"]),
  });
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = "http://127.0.0.1:" + address.port;
  async function request(path, opts = {}) {
    const headers = {};
    const method = opts.method ?? "GET";
    if (method !== "GET" && opts.requestOrigin !== null) headers.Origin = opts.requestOrigin ?? origin;
    if (opts.cookie) headers.Cookie = opts.cookie;
    if (opts.csrf) headers["X-CSRF-Token"] = opts.csrf;
    if (opts.fetchSite) headers["Sec-Fetch-Site"] = opts.fetchSite;
    if (opts.bearer) headers.Authorization = "Bearer " + opts.bearer;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(base + path, {
      method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const data = response.status === 204 ? null : await response.json();
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    return { response, data, cookie };
  }
  async function csrf(cookie) {
    const r = await request("/api/v1/auth/csrf", { cookie });
    assert.equal(r.response.status, 200);
    return String(r.data.data.csrfToken);
  }
  async function login(email, password) {
    return request("/api/v1/auth/login", { method: "POST", body: { email, password } });
  }
  try {
    const agent = await db.user.create({ data: {
      email: `agent.${randomUUID()}@invalid.example`, displayName: "Test Agent",
      role: "SUPPORT_AGENT", accountStatus: "ACTIVE", passwordHash: adminHash,
    } });
    const eligibilityPath = `/internal/v1/users/${agent.id}/agent-eligibility`;
    assert.equal((await request(eligibilityPath)).response.status, 401);
    assert.equal((await request(eligibilityPath, { bearer: serviceTokenB })).response.status, 403);
    const eligible = await request(eligibilityPath, { bearer: serviceTokenA });
    assert.equal(eligible.response.status, 200);
    assert.deepEqual(eligible.data.data, { eligible: true });
    assert.equal(eligible.response.headers.get("cache-control"), "no-store");
    const nonAgent = await request(`/internal/v1/users/${admin.id}/agent-eligibility`, { bearer: serviceTokenA });
    assert.deepEqual(nonAgent.data.data, { eligible: false });
    const absent = await request(`/internal/v1/users/${randomUUID()}/agent-eligibility`, { bearer: serviceTokenA });
    assert.deepEqual(absent.data.data, { eligible: false });
    await db.user.update({ where: { id: agent.id }, data: { accountStatus: "DISABLED" } });
    assert.deepEqual((await request(eligibilityPath, { bearer: serviceTokenA })).data.data, { eligible: false });

    const health = await request("/health");
    assert.equal(health.response.status, 200);
    assert.equal((await request("/api/v1/auth/me")).response.status, 401);
    const blocked = await request("/api/v1/auth/login", {
      method: "POST", requestOrigin: "https://evil.invalid",
      body: { email: admin.email, password: adminPassword },
    });
    assert.equal(blocked.response.status, 403);

    const adminLogin = await login(admin.email, adminPassword);
    assert.equal(adminLogin.response.status, 200);
    assert.equal(adminLogin.data.data.mustChangePassword, false);
    assert.match(adminLogin.response.headers.get("set-cookie") ?? "", /HttpOnly; Secure; SameSite=Strict/);
    assert.equal(adminLogin.response.headers.get("cache-control"), "no-store");
    assert(adminLogin.cookie);
    const adminCookie = adminLogin.cookie;
    const adminCsrf = await csrf(adminCookie);

    const teacherEmail = "teacher." + randomUUID() + "@invalid.example";
    const payload = { email: teacherEmail, displayName: "Test Teacher", role: "REPORTER" };
    const forbiddenCreate = await request("/api/v1/admin/users", {
      method: "POST", cookie: adminCookie, body: payload,
    });
    assert.equal(forbiddenCreate.response.status, 403);
    const create = await request("/api/v1/admin/users", {
      method: "POST", cookie: adminCookie, csrf: adminCsrf, body: payload,
    });
    assert.equal(create.response.status, 201);
    assert.equal(create.response.headers.get("cache-control"), "no-store");
    assert.equal(create.data.data.user.accountStatus, "PENDING_PASSWORD_CHANGE");
    assert.equal(create.data.data.user.role, "REPORTER");
    assert(!("passwordHash" in create.data.data.user));
    const teacherId = create.data.data.user.id;
    const firstTemporary = create.data.data.temporaryPassword;
    assert(firstTemporary.length >= 32);
    const duplicate = await request("/api/v1/admin/users", {
      method: "POST", cookie: adminCookie, csrf: adminCsrf,
      body: { ...payload, email: teacherEmail.toUpperCase() },
    });
    assert.equal(duplicate.response.status, 409);
    const badAdmin = await request("/api/v1/admin/users", {
      method: "POST", cookie: adminCookie, csrf: adminCsrf,
      body: { email: "another." + randomUUID() + "@invalid.example", displayName: "Bad", role: "ADMIN" },
    });
    assert.equal(badAdmin.response.status, 422);

    const listing = await request("/api/v1/admin/users?limit=10", { cookie: adminCookie });
    assert.equal(listing.response.status, 200);
    assert(listing.data.data.items.some((item) => item.id === teacherId));
    assert(!("passwordHash" in listing.data.data.items[0]));

    const tempLogin = await login(teacherEmail, firstTemporary);
    assert.equal(tempLogin.response.status, 200);
    assert.equal(tempLogin.data.data.mustChangePassword, true);
    assert(tempLogin.cookie);
    const temporaryCookie = tempLogin.cookie;
    const temporaryToken = temporaryCookie.split("=")[1];
    for (const bearer of [serviceTokenA, serviceTokenB]) {
      const provisional = await request("/internal/v1/sessions/introspect", {
        method: "POST", requestOrigin: null, bearer, body: { sessionToken: temporaryToken },
      });
      assert.equal(provisional.response.status, 200);
      assert.deepEqual(provisional.data.data, { active: false });
    }
    const temporaryCsrf = await csrf(temporaryCookie);
    assert.equal((await request("/api/v1/admin/users", { cookie: temporaryCookie })).response.status, 403);
    const blockedPassword = await request("/api/v1/auth/password/activate", {
      method: "POST", cookie: temporaryCookie, csrf: temporaryCsrf,
      body: { currentPassword: firstTemporary, newPassword: "blocked integration password" },
    });
    assert.equal(blockedPassword.response.status, 422);
    assert.equal(blockedPassword.data.error.code, "WEAK_PASSWORD");
    const newTeacherPassword = randomBytes(32).toString("base64url");
    const activation = await request("/api/v1/auth/password/activate", {
      method: "POST", cookie: temporaryCookie, csrf: temporaryCsrf,
      body: { currentPassword: firstTemporary, newPassword: newTeacherPassword },
    });
    assert.equal(activation.response.status, 204);
    assert.equal((await request("/api/v1/auth/me", { cookie: temporaryCookie })).response.status, 401);
    assert.equal((await login(teacherEmail, firstTemporary)).response.status, 401);
    const teacherLogin = await login(teacherEmail, newTeacherPassword);
    assert.equal(teacherLogin.response.status, 200);
    assert.equal(teacherLogin.data.data.mustChangePassword, false);
    assert(teacherLogin.cookie);
    const teacherCookie = teacherLogin.cookie;
    const teacherToken = teacherCookie.split("=")[1];
    const teacherSessionCsrf = await csrf(teacherCookie);
    for (const options of [
      { requestOrigin: "https://untrusted.invalid" },
      { requestOrigin: null },
      { fetchSite: "cross-site" },
      { csrf: teacherSessionCsrf },
    ]) {
      const forbidden = await request(`/api/v1/admin/users/${teacherId}/disable`, {
        method: "POST", cookie: adminCookie, csrf: adminCsrf, ...options,
      });
      assert.equal(forbidden.response.status, 403);
      assert.equal((await request("/api/v1/auth/me", { cookie: teacherCookie })).response.status, 200);
    }
    assert.equal((await request("/api/v1/admin/users", { cookie: teacherCookie })).response.status, 403);
    assert.equal((await request(`/api/v1/admin/users/${teacherId}/disable`, {
      method: "POST", cookie: teacherCookie, csrf: teacherSessionCsrf,
    })).response.status, 403);
    assert.equal((await request(`/api/v1/admin/users/${teacherId}/reset-password`, {
      method: "POST", cookie: teacherCookie, csrf: teacherSessionCsrf,
    })).response.status, 403);
    assert.equal((await request(`/api/v1/admin/users/${teacherId}/disable`, {
      method: "POST", cookie: adminCookie, csrf: teacherSessionCsrf,
    })).response.status, 403);
    assert.equal((await request("/api/v1/auth/me", { cookie: teacherCookie })).response.status, 200);

    const introspection = await request("/internal/v1/sessions/introspect", {
      method: "POST", requestOrigin: null, bearer: serviceTokenA,
      body: { sessionToken: teacherToken },
    });
    assert.equal(introspection.response.status, 200);
    assert.equal(introspection.data.data.active, true);
    assert.equal(introspection.data.data.subject.userId, teacherId);
    assert.equal(introspection.data.data.subject.role, "REPORTER");
    const teacherCsrf = await csrf(teacherCookie);
    for (const [csrfValue, expected] of [[teacherCsrf, true], [adminCsrf, false], ["", false]]) {
      const result = await request("/internal/v1/sessions/introspect", {
        method: "POST", requestOrigin: null, bearer: serviceTokenA,
        body: { sessionToken: teacherToken, csrfToken: csrfValue },
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.data.data.csrfValid, expected);
    }

    // Age a real session without waiting for the idle timeout.
    const idleLogin = await login(teacherEmail, newTeacherPassword);
    assert.equal(idleLogin.response.status, 200);
    const idleToken = idleLogin.cookie.split("=")[1];
    await db.session.updateMany({ where: { userId: teacherId, tokenHash: tokenHash(idleToken) },
      data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    assert.equal((await request("/api/v1/auth/me", { cookie: idleLogin.cookie })).response.status, 401);
    const idleIntrospection = await request("/internal/v1/sessions/introspect", {
      method: "POST", requestOrigin: null, bearer: serviceTokenB, body: { sessionToken: idleToken },
    });
    assert.equal(idleIntrospection.data.data.active, false);
    const idleCsrf = await request("/internal/v1/sessions/introspect", {
      method: "POST", requestOrigin: null, bearer: serviceTokenA,
      body: { sessionToken: idleToken, csrfToken: teacherCsrf },
    });
    assert.deepEqual(idleCsrf.data.data, { active: false, csrfValid: false });

    const unauthorizedIntrospection = await request("/internal/v1/sessions/introspect", {
      method: "POST", requestOrigin: null, bearer: "invalid-credential",
      body: { sessionToken: teacherToken },
    });
    assert.equal(unauthorizedIntrospection.response.status, 401);

    let resumeLogin;
    let loginPaused;
    const loginReachedCreation = new Promise((resolve) => { loginPaused = resolve; });
    const loginMayContinue = new Promise((resolve) => { resumeLogin = resolve; });
    pauseLoginLookup = async () => { loginPaused(); await loginMayContinue; };
    const concurrentLogin = login(teacherEmail, newTeacherPassword);
    await loginReachedCreation;
    const reset = await request("/api/v1/admin/users/" + teacherId + "/reset-password", {
      method: "POST", cookie: adminCookie, csrf: adminCsrf,
    });
    pauseLoginLookup = undefined;
    assert.equal(reset.response.status, 200);
    assert.equal(reset.response.headers.get("cache-control"), "no-store");
    const resetTemporary = reset.data.data.temporaryPassword;
    assert.equal((await request("/api/v1/auth/me", { cookie: teacherCookie })).response.status, 401);
    const resetLogin = await login(teacherEmail, resetTemporary);
    assert.equal(resetLogin.response.status, 200);
    assert.equal(resetLogin.data.data.mustChangePassword, true);
    assert(resetLogin.cookie);
    const resetCsrf = await csrf(resetLogin.cookie);
    const passwordAfterReset = randomBytes(32).toString("base64url");
    assert.equal((await request("/api/v1/auth/password/activate", {
      method: "POST", cookie: resetLogin.cookie, csrf: resetCsrf,
      body: { currentPassword: resetTemporary, newPassword: passwordAfterReset },
    })).response.status, 204);
    resumeLogin();
    const staleLogin = await concurrentLogin;
    assert.equal(staleLogin.response.status, 401, "a login using the old password must be rejected after reset and activation");
    assert.equal(staleLogin.cookie, undefined);
    const currentTeacherLogin = await login(teacherEmail, passwordAfterReset);
    assert.equal(currentTeacherLogin.response.status, 200);
    assert(currentTeacherLogin.cookie);
    const currentTeacherToken = currentTeacherLogin.cookie.split("=")[1];

    const blockSelf = await request("/api/v1/admin/users/" + admin.id + "/disable", {
      method: "POST", cookie: adminCookie, csrf: adminCsrf,
    });
    assert.equal(blockSelf.response.status, 403);
    const disable = await request("/api/v1/admin/users/" + teacherId + "/disable", {
      method: "POST", cookie: adminCookie, csrf: adminCsrf,
    });
    assert.equal(disable.response.status, 204);
    assert.equal((await request("/api/v1/auth/me", { cookie: currentTeacherLogin.cookie })).response.status, 401);
    const disabledIntrospection = await request("/internal/v1/sessions/introspect", {
      method: "POST", requestOrigin: null, bearer: serviceTokenB,
      body: { sessionToken: currentTeacherToken },
    });
    assert.equal(disabledIntrospection.data.data.active, false);
    const disableAgain = await request("/api/v1/admin/users/" + teacherId + "/disable", {
      method: "POST", cookie: adminCookie, csrf: adminCsrf,
    });
    assert.equal(disableAgain.response.status, 204);

    const resetWhileDisabled = await request("/api/v1/admin/users/" + teacherId + "/reset-password", {
      method: "POST", cookie: adminCookie, csrf: adminCsrf,
    });
    assert.equal(resetWhileDisabled.response.status, 409);
    const reactivate = await request("/api/v1/admin/users/" + teacherId + "/reactivate", {
      method: "POST", cookie: adminCookie, csrf: adminCsrf,
    });
    assert.equal(reactivate.response.status, 200);
    assert.equal(reactivate.response.headers.get("cache-control"), "no-store");
    assert.equal(reactivate.data.data.user.accountStatus, "PENDING_PASSWORD_CHANGE");
    const newTemporary = reactivate.data.data.temporaryPassword;
    assert.notEqual(newTemporary, firstTemporary);
    assert.equal((await login(teacherEmail, newTeacherPassword)).response.status, 401);
    const reactivatedLogin = await login(teacherEmail, newTemporary);
    assert.equal(reactivatedLogin.response.status, 200);
    assert.equal(reactivatedLogin.data.data.mustChangePassword, true);
    assert(reactivatedLogin.cookie);
    const reactivatedCsrf = await csrf(reactivatedLogin.cookie);
    const nextPassword = randomBytes(32).toString("base64url");
    assert.equal((await request("/api/v1/auth/password/activate", {
      method: "POST", cookie: reactivatedLogin.cookie, csrf: reactivatedCsrf,
      body: { currentPassword: newTemporary, newPassword: nextPassword },
    })).response.status, 204);
    const fullAfterReactivation = await login(teacherEmail, nextPassword);
    assert.equal(fullAfterReactivation.response.status, 200);
    assert(fullAfterReactivation.cookie);
    assert.equal((await request("/api/v1/auth/logout", {
      method: "POST", cookie: fullAfterReactivation.cookie,
    })).response.status, 403);
    const finalCsrf = await csrf(fullAfterReactivation.cookie);
    assert.equal((await request("/api/v1/auth/logout", {
      method: "POST", cookie: fullAfterReactivation.cookie, csrf: finalCsrf,
    })).response.status, 204);
    const loggedOutToken = fullAfterReactivation.cookie.split("=")[1];
    for (const bearer of [serviceTokenA, serviceTokenB]) {
      const loggedOut = await request("/internal/v1/sessions/introspect", {
        method: "POST", requestOrigin: null, bearer, body: { sessionToken: loggedOutToken },
      });
      assert.equal(loggedOut.response.status, 200);
      assert.deepEqual(loggedOut.data.data, { active: false });
    }
    assert.equal((await request("/api/v1/auth/me", {
      cookie: fullAfterReactivation.cookie,
    })).response.status, 401);

    const events = await db.accountAudit.findMany({ where: { subjectUserId: teacherId } });
    for (const action of ["CREATED", "PASSWORD_ACTIVATED", "DISABLED", "REACTIVATED"]) {
      assert(events.some((event) => event.action === action), action);
    }

    const crossOrigin = await fetch(base + "/api/v1/auth/me", {
      headers: { Cookie: adminCookie, Origin: "https://untrusted.invalid" },
    });
    assert.equal(crossOrigin.headers.get("access-control-allow-origin"), null);

    const retryEmail = "retry." + randomUUID() + "@invalid.example";
    const retryUser = await request("/api/v1/admin/users", {
      method: "POST", cookie: adminCookie, csrf: adminCsrf,
      body: { ...payload, email: retryEmail },
    });
    assert.equal(retryUser.response.status, 201);
    const retryLogin = await login(retryEmail, retryUser.data.data.temporaryPassword);
    assert.equal(retryLogin.response.status, 200);
    const retryCsrf = await csrf(retryLogin.cookie);
    for (let i = 0; i < 21; i++) {
      const attempt = await request("/api/v1/auth/password/activate", {
        method: "POST", cookie: retryLogin.cookie, csrf: retryCsrf,
        body: { currentPassword: "invalid", newPassword: "short" },
      });
      assert.equal(attempt.response.status, i < 20 ? 422 : 429);
    }

    let limited = false;
    for (let i = 0; i < 25; i++) {
      const retry = await fetch(base + "/api/v1/auth/login", {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100." + (i + 1),
        },
        body: JSON.stringify({ email: "nonexistent@invalid.example", password: randomBytes(32).toString("base64url") }),
      });
      if (retry.status === 429) {
        limited = true;
        break;
      }
      assert.equal(retry.status, 401);
    }
    assert.equal(limited, true, "IP spoofing must not bypass login rate limiting");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await db.$disconnect();
  }
});
