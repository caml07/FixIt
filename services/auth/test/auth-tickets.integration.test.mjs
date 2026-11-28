import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import argon2 from "argon2";
import pg from "pg";
import { createAuthApp } from "../src/app.ts";
import { openAuthDatabase } from "../src/db.ts";

test("Auth and Tickets integration with the published configuration and a test-only CSRF verifier", {
  skip: process.env.FIXIT_AUTH_TICKETS_TEST !== "1", timeout: 30000,
}, async () => {
  const { FIXIT_TEST_DB_URL: authUrl, FIXIT_TEST_TICKETS_DB_URL: ticketsUrl, FIXIT_TICKETS_REVIEW_DIR: ticketsDir } = process.env;
  assert.ok(authUrl && ticketsUrl && ticketsDir);
  assert.match(process.versions.node, /^24\./, "Tickets requires Node 24");
  const { createApp } = await import(pathToFileURL(join(ticketsDir, "dist", "app.js")).href);
  const authDb = openAuthDatabase(authUrl);
  const authSql = new pg.Pool({ connectionString: authUrl, max: 1 });
  const ticketsDb = new pg.Pool({ connectionString: ticketsUrl, max: 2 });
  const origin = "https://fixit.example.invalid";
  const serviceCredential = randomUUID();
  let authServer;
  let ticketsServer;
  let connectedTicketsServer;
  try {
    await assert.rejects(ticketsDb.query("SELECT password_hash FROM auth.users LIMIT 1"), (error) => error.code === "42501");
    await assert.rejects(authSql.query("SELECT id FROM tickets.support_tickets LIMIT 1"), (error) => error.code === "42501");
    const email = `integration.${randomUUID()}@invalid.example`;
    const password = randomBytes(32).toString("base64url");
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const reporter = await authDb.user.create({ data: { email, passwordHash, displayName: "Integration Reporter",
      role: "REPORTER", accountStatus: "ACTIVE" } });
    const other = await authDb.user.create({ data: { email: `other.${randomUUID()}@invalid.example`, passwordHash,
      displayName: "Other Reporter", role: "REPORTER", accountStatus: "ACTIVE" } });
    const ownTicket = await ticketsDb.query(`INSERT INTO tickets.support_tickets
      (reporter_id, category_code, title, description, reporter_urgency)
      VALUES ($1, 'NETWORK', 'Own ticket', 'Synthetic integration', 'NORMAL') RETURNING id`, [reporter.id]);
    const otherTicket = await ticketsDb.query(`INSERT INTO tickets.support_tickets
      (reporter_id, category_code, title, description, reporter_urgency)
      VALUES ($1, 'NETWORK', 'Other ticket', 'Synthetic integration', 'NORMAL') RETURNING id`, [other.id]);
    authServer = createServer(createAuthApp({ database: authDb, publicOrigin: origin, csrfKey: randomUUID(),
      serviceTokens: [serviceCredential, randomUUID()] }));
    authServer.listen(0, "127.0.0.1");
    await once(authServer, "listening");
    const authAddress = authServer.address();
    assert(authAddress && typeof authAddress !== "string");
    const authBase = `http://127.0.0.1:${authAddress.port}`;
    ticketsServer = createServer(createApp(() => false, { database: ticketsDb, authUrl: authBase, serviceToken: serviceCredential }));
    ticketsServer.listen(0, "127.0.0.1");
    await once(ticketsServer, "listening");
    const ticketsAddress = ticketsServer.address();
    assert(ticketsAddress && typeof ticketsAddress !== "string");
    const ticketsBase = `http://127.0.0.1:${ticketsAddress.port}`;
    const login = await fetch(`${authBase}/api/v1/auth/login`, { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);
    const csrf = (await (await fetch(`${authBase}/api/v1/auth/csrf`, { headers: { Cookie: cookie } })).json()).data.csrfToken;
    const categories = await fetch(`${ticketsBase}/api/v1/categories`, { headers: { Cookie: cookie } });
    assert.equal(categories.status, 200);
    assert.ok((await categories.json()).data.items.length > 0);
    const ticketList = await fetch(`${ticketsBase}/api/v1/tickets`, { headers: { Cookie: cookie } });
    assert.equal(ticketList.status, 200);
    const listed = (await ticketList.json()).data.items.map((ticket) => ticket.id);
    assert.ok(listed.includes(ownTicket.rows[0].id));
    assert.equal(listed.includes(otherTicket.rows[0].id), false);
    assert.equal((await fetch(`${ticketsBase}/api/v1/tickets/${ownTicket.rows[0].id}`, { headers: { Cookie: cookie } })).status, 200);
    assert.equal((await fetch(`${ticketsBase}/api/v1/tickets/${otherTicket.rows[0].id}`, { headers: { Cookie: cookie } })).status, 404);
    const before = await ticketsDb.query("SELECT count(*)::int AS count FROM tickets.support_tickets WHERE reporter_id = $1", [reporter.id]);
    const create = await fetch(`${ticketsBase}/api/v1/tickets`, { method: "POST", headers: {
      Cookie: cookie, Origin: origin, "X-CSRF-Token": csrf, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Integration test", description: "Synthetic test ticket",
        category: "NETWORK", reporterUrgency: "NORMAL" }) });
    assert.equal(create.status, 403);
    const after = await ticketsDb.query("SELECT count(*)::int AS count FROM tickets.support_tickets WHERE reporter_id = $1", [reporter.id]);
    assert.equal(after.rows[0].count, before.rows[0].count);

    // The verifier is a test harness; the published Tickets server does not wire it yet.
    let injectVerifierFailure = false;
    const verifyCsrf = async (csrfToken, sessionToken) => {
      if (injectVerifierFailure) throw new Error("synthetic verifier failure");
      const response = await fetch(`${authBase}/internal/v1/sessions/introspect`, {
        method: "POST", headers: { Authorization: `Bearer ${serviceCredential}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken, csrfToken }), signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error("Auth verifier unavailable");
      const result = await response.json();
      return result.data.active === true && result.data.csrfValid === true;
    };
    connectedTicketsServer = createServer(createApp(() => false, {
      database: ticketsDb, authUrl: authBase, serviceToken: serviceCredential, publicOrigin: origin, verifyCsrf,
    }));
    connectedTicketsServer.listen(0, "127.0.0.1");
    await once(connectedTicketsServer, "listening");
    const connectedAddress = connectedTicketsServer.address();
    assert(connectedAddress && typeof connectedAddress !== "string");
    const connectedBase = `http://127.0.0.1:${connectedAddress.port}`;
    const payload = { title: "Verified integration", description: "Synthetic integration test",
      category: "NETWORK", reporterUrgency: "NORMAL" };
    const submit = (csrfValue, requestOrigin = origin) => fetch(`${connectedBase}/api/v1/tickets`, {
      method: "POST", headers: { Cookie: cookie, Origin: requestOrigin, "X-CSRF-Token": csrfValue, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert.equal((await submit(randomUUID())).status, 403);
    assert.equal((await submit(csrf, "https://untrusted.invalid")).status, 403);
    injectVerifierFailure = true;
    assert.equal((await submit(csrf)).status, 403, "current Tickets maps verifier failure to 403, pending 503 fix");
    injectVerifierFailure = false;
    assert.equal((await ticketsDb.query("SELECT count(*)::int AS count FROM tickets.support_tickets WHERE reporter_id = $1", [reporter.id])).rows[0].count,
      before.rows[0].count, "rejected requests must not create tickets");
    const accepted = await submit(csrf);
    assert.equal(accepted.status, 201);
    const createdId = (await accepted.json()).data.id;
    assert.equal((await ticketsDb.query("SELECT count(*)::int AS count FROM tickets.ticket_timeline WHERE ticket_id = $1", [createdId])).rows[0].count, 1);
    assert.equal((await ticketsDb.query("SELECT count(*)::int AS count FROM tickets.outbox WHERE ticket_id = $1", [createdId])).rows[0].count, 1);

    const adminEmail = `admin.${randomUUID()}@invalid.example`;
    await authDb.user.create({ data: { email: adminEmail, passwordHash, displayName: "Integration Admin", role: "ADMIN", accountStatus: "ACTIVE" } });
    const oldAgent = await authDb.user.create({ data: { email: `old-agent.${randomUUID()}@invalid.example`, passwordHash,
      displayName: "Previous agent", role: "SUPPORT_AGENT", accountStatus: "ACTIVE" } });
    const nextAgent = await authDb.user.create({ data: { email: `next-agent.${randomUUID()}@invalid.example`, passwordHash,
      displayName: "Next agent", role: "SUPPORT_AGENT", accountStatus: "ACTIVE" } });
    const disabledAgent = await authDb.user.create({ data: { email: `disabled-agent.${randomUUID()}@invalid.example`, passwordHash,
      displayName: "Disabled agent", role: "SUPPORT_AGENT", accountStatus: "DISABLED" } });
    const assigned = await ticketsDb.query(`INSERT INTO tickets.support_tickets
      (reporter_id, assignee_id, category_code, title, description, reporter_urgency, status)
      VALUES ($1, $2, 'NETWORK', 'Assigned', 'Synthetic integration', 'NORMAL', 'ASSIGNED') RETURNING id`, [reporter.id, oldAgent.id]);
    const adminLogin = await fetch(`${authBase}/api/v1/auth/login`, { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email: adminEmail, password }) });
    assert.equal(adminLogin.status, 200);
    const adminCookie = adminLogin.headers.get("set-cookie")?.split(";")[0];
    assert.ok(adminCookie);
    const adminCsrf = (await (await fetch(`${authBase}/api/v1/auth/csrf`, { headers: { Cookie: adminCookie } })).json()).data.csrfToken;
    const reassign = (assigneeId) => fetch(`${connectedBase}/api/v1/tickets/${assigned.rows[0].id}/assignee`, {
      method: "PATCH", headers: { Cookie: adminCookie, Origin: origin, "X-CSRF-Token": adminCsrf, "Content-Type": "application/json" },
      body: JSON.stringify({ assigneeId, expectedVersion: 1, reason: "Integration test" }),
    });
    assert.equal((await reassign(disabledAgent.id)).status, 409);
    assert.equal((await ticketsDb.query("SELECT assignee_id FROM tickets.support_tickets WHERE id = $1", [assigned.rows[0].id])).rows[0].assignee_id, oldAgent.id);
    assert.equal((await ticketsDb.query("SELECT count(*)::int AS count FROM tickets.ticket_timeline WHERE ticket_id = $1", [assigned.rows[0].id])).rows[0].count, 0);
    assert.equal((await ticketsDb.query("SELECT count(*)::int AS count FROM tickets.outbox WHERE ticket_id = $1", [assigned.rows[0].id])).rows[0].count, 0);
    const reassigned = await reassign(nextAgent.id);
    assert.equal(reassigned.status, 200);
    assert.equal((await reassigned.json()).data.assigneeId, nextAgent.id);
    assert.equal((await ticketsDb.query("SELECT count(*)::int AS count FROM tickets.ticket_timeline WHERE ticket_id = $1", [assigned.rows[0].id])).rows[0].count, 1);
    assert.equal((await ticketsDb.query("SELECT count(*)::int AS count FROM tickets.outbox WHERE ticket_id = $1", [assigned.rows[0].id])).rows[0].count, 1);
    assert.equal((await fetch(`${authBase}/api/v1/auth/logout`, { method: "POST", headers: {
      Cookie: cookie, Origin: origin, "X-CSRF-Token": csrf } })).status, 204);
    assert.equal((await fetch(`${ticketsBase}/api/v1/tickets`, { headers: { Cookie: cookie } })).status, 401);
    const secondLogin = await fetch(`${authBase}/api/v1/auth/login`, { method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(secondLogin.status, 200);
    const secondCookie = secondLogin.headers.get("set-cookie")?.split(";")[0];
    assert.ok(secondCookie);
    await new Promise((resolve) => authServer.close(resolve));
    authServer = undefined;
    assert.equal((await fetch(`${ticketsBase}/api/v1/categories`, { headers: { Cookie: secondCookie } })).status, 503);
  } finally {
    if (connectedTicketsServer) await new Promise((resolve) => connectedTicketsServer.close(resolve));
    if (ticketsServer) await new Promise((resolve) => ticketsServer.close(resolve));
    if (authServer) await new Promise((resolve) => authServer.close(resolve));
    await ticketsDb.end();
    await authSql.end();
    await authDb.$disconnect();
  }
});
