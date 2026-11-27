import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { createDatabase, cleanup } from "./fixtures/postgres17.mjs";
import { openTicketsDatabase } from "../dist/database.js";
import { createApp } from "../dist/app.js";

test("intake and authorized reads enforce contracts against PostgreSQL", { timeout: 120000 }, async () => {
  const fixture = await createDatabase();
  let owner;
  let pool;
  let server;
  let auth;
  try {
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma.config.ts"], {
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, DATABASE_URL: fixture.ownerUrl }, timeout: 60000, stdio: "ignore"
    });
    owner = new pg.Client({ connectionString: fixture.ownerUrl });
    await owner.connect();
    await owner.query("GRANT USAGE ON SCHEMA tickets TO tickets_runtime");
    await owner.query("GRANT SELECT ON ALL TABLES IN SCHEMA tickets TO tickets_runtime");
    await owner.query("GRANT INSERT, UPDATE ON ALL TABLES IN SCHEMA tickets TO tickets_runtime");
    await owner.query("INSERT INTO auth.users (id, email, display_name, role, account_status, password_hash) VALUES ('550e8400-e29b-41d4-a716-446655440000', 'reporter@example.test', 'Synthetic', 'REPORTER', 'ACTIVE', 'synthetic')");
    await owner.query("INSERT INTO auth.users (id, email, display_name, role, account_status, password_hash) VALUES ('550e8400-e29b-41d4-a716-446655440002', 'other@example.test', 'Synthetic', 'REPORTER', 'ACTIVE', 'synthetic'), ('550e8400-e29b-41d4-a716-446655440003', 'agent@example.test', 'Synthetic', 'SUPPORT_AGENT', 'ACTIVE', 'synthetic'), ('550e8400-e29b-41d4-a716-446655440004', 'admin@example.test', 'Synthetic', 'ADMIN', 'ACTIVE', 'synthetic')");
    await owner.query("UPDATE tickets.categories SET is_active = false WHERE code = 'HARDWARE'");
    pool = openTicketsDatabase(fixture.runtimeUrl);
    auth = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        assert.equal(req.url, "/internal/v1/sessions/introspect");
        assert.equal(req.headers.authorization, "Bearer test");
        const token = JSON.parse(body).sessionToken;
        const identities = {
          valid: ["550e8400-e29b-41d4-a716-446655440000", "REPORTER"],
          other: ["550e8400-e29b-41d4-a716-446655440002", "REPORTER"],
          agent: ["550e8400-e29b-41d4-a716-446655440003", "SUPPORT_AGENT"],
          admin: ["550e8400-e29b-41d4-a716-446655440004", "ADMIN"]
        };
        const identity = identities[token];
        const active = Boolean(identity) || token === "expired";
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: active ? { active: true, subject: { userId: identity?.[0] ?? "550e8400-e29b-41d4-a716-446655440000", role: identity?.[1] ?? "REPORTER" }, expiresAt: token === "expired" ? "2000-01-01T00:00:00Z" : "2099-01-01T00:00:00Z" } : { active: false }, requestId: "550e8400-e29b-41d4-a716-446655440001" }));
      });
    }).listen(0, "127.0.0.1");
    await new Promise((resolve) => auth.once("listening", resolve));
    server = createApp(() => false, { database: pool, authUrl: `http://127.0.0.1:${auth.address().port}`, serviceToken: "test", publicOrigin: "https://fixit.invalid", verifyCsrf: async (token) => token === "synthetic-csrf" }).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${server.address().port}/api/v1/categories`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { cookie: "__Host-fixit_session=invalid" } })).status, 401);
    assert.equal((await fetch(url, { headers: { cookie: "__Host-fixit_session=revoked" } })).status, 401);
    assert.equal((await fetch(url, { headers: { cookie: "__Host-fixit_session=restricted" } })).status, 401);
    const response = await fetch(url, { headers: { cookie: "__Host-fixit_session=valid" } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.items.length, 4);
    assert.ok(body.data.items.every((item) => Object.keys(item).sort().join(",") === "code,label"));
    const ticketUrl = `http://127.0.0.1:${server.address().port}/api/v1/tickets`;
    const ticket = { title: "Synthetic issue", description: "Synthetic description", category: "NETWORK", reporterUrgency: "HIGH" };
    const headers = { cookie: "__Host-fixit_session=valid", origin: "https://fixit.invalid", "sec-fetch-site": "same-origin", "x-csrf-token": "synthetic-csrf", "content-type": "application/json" };
    const created = await fetch(ticketUrl, { method: "POST", headers, body: JSON.stringify(ticket) });
    assert.equal(created.status, 201);
    const createdBody = await created.json();
    assert.equal(createdBody.data.reporterId, "550e8400-e29b-41d4-a716-446655440000");
    assert.equal(createdBody.data.status, "OPEN");
    assert.equal(createdBody.data.version, 1);
    assert.equal(createdBody.data.reporterUrgency, "HIGH");
    assert.equal(createdBody.data.effectivePriority, null);
    assert.equal(createdBody.data.assigneeId, null);
    const timeline = await owner.query("SELECT event_type FROM tickets.ticket_timeline WHERE ticket_id = $1", [createdBody.data.id]);
    assert.deepEqual(timeline.rows, [{ event_type: "CREATED" }]);
    const events = await owner.query("SELECT id, event_type, payload FROM tickets.outbox WHERE ticket_id = $1", [createdBody.data.id]);
    assert.equal(events.rows.length, 1);
    assert.equal(events.rows[0].event_type, "ticket.created.v1");
    assert.equal(events.rows[0].payload.eventId, events.rows[0].id);
    assert.equal(events.rows[0].payload.aggregateId, createdBody.data.id);
    assert.equal(events.rows[0].payload.aggregateVersion, 1);
    assert.equal(events.rows[0].payload.payload.reporterId, createdBody.data.reporterId);
    const listed = await fetch(ticketUrl, { headers: { cookie: "__Host-fixit_session=valid" } });
    assert.equal(listed.status, 200);
    const listing = await listed.json();
    assert.equal(listing.data.items.length, 1);
    assert.deepEqual(Object.keys(listing.data.items[0]).sort(), ["category", "createdAt", "effectivePriority", "id", "reporterUrgency", "status", "title"]);
    const detail = await fetch(ticketUrl + "/" + createdBody.data.id, { headers: { cookie: "__Host-fixit_session=valid" } });
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).data.id, createdBody.data.id);
    assert.equal((await fetch(ticketUrl + "/" + createdBody.data.id, { headers: { cookie: "__Host-fixit_session=other" } })).status, 404);
    assert.equal((await fetch(ticketUrl + "/" + createdBody.data.id, { headers: { cookie: "__Host-fixit_session=agent" } })).status, 404);
    assert.equal((await fetch(ticketUrl + "/" + createdBody.data.id, { headers: { cookie: "__Host-fixit_session=admin" } })).status, 200);
    assert.equal((await fetch(ticketUrl, { headers: { cookie: "__Host-fixit_session=expired" } })).status, 401);
    assert.equal((await fetch(ticketUrl + "?scope=all", { headers: { cookie: "__Host-fixit_session=valid" } })).status, 403);
    assert.equal((await fetch(ticketUrl + "?cursor=invalid", { headers: { cookie: "__Host-fixit_session=valid" } })).status, 422);
    assert.equal((await fetch(ticketUrl, { method: "POST", headers: { ...headers, cookie: "__Host-fixit_session=agent" }, body: JSON.stringify(ticket) })).status, 403);
    assert.equal((await fetch(ticketUrl, { method: "POST", headers: { ...headers, "x-csrf-token": "wrong" }, body: JSON.stringify(ticket) })).status, 403);
    const missingCsrf = { ...headers };
    delete missingCsrf["x-csrf-token"];
    assert.equal((await fetch(ticketUrl, { method: "POST", headers: missingCsrf, body: JSON.stringify(ticket) })).status, 403);
    assert.equal((await fetch(ticketUrl, { method: "POST", headers: { ...headers, origin: "https://evil.invalid" }, body: JSON.stringify(ticket) })).status, 403);
    assert.equal((await fetch(ticketUrl, { method: "POST", headers: { ...headers, "sec-fetch-site": "cross-site" }, body: JSON.stringify(ticket) })).status, 403);
    assert.equal((await fetch(ticketUrl, { method: "POST", headers, body: JSON.stringify({ ...ticket, category: "HARDWARE" }) })).status, 422);
    assert.equal((await fetch(ticketUrl, { method: "POST", headers, body: JSON.stringify({ ...ticket, category: "UNKNOWN" }) })).status, 422);
    for (const field of ["reporterId", "assigneeId", "status", "effectivePriority"]) {
      assert.equal((await fetch(ticketUrl, { method: "POST", headers, body: JSON.stringify({ ...ticket, [field]: "test" }) })).status, 422);
    }
    assert.equal((await fetch(ticketUrl, { method: "POST", headers, body: JSON.stringify({ ...ticket, reporterUrgency: ["HIGH"] }) })).status, 422);
    assert.equal((await fetch(ticketUrl, { method: "POST", headers, body: "{" })).status, 422);
    const failClosed = createApp(() => false, { database: pool, authUrl: `http://127.0.0.1:${auth.address().port}`, serviceToken: "test", publicOrigin: "https://fixit.invalid" }).listen(0, "127.0.0.1");
    await new Promise((resolve) => failClosed.once("listening", resolve));
    try {
      assert.equal((await fetch(`http://127.0.0.1:${failClosed.address().port}/api/v1/tickets`, { method: "POST", headers, body: JSON.stringify(ticket) })).status, 403);
    } finally {
      await new Promise((resolve) => failClosed.close(resolve));
    }
    await owner.query("INSERT INTO tickets.support_tickets (reporter_id, category_code, title, description, reporter_urgency) VALUES ('550e8400-e29b-41d4-a716-446655440002', 'NETWORK', 'Other ticket', 'Synthetic', 'NORMAL')");
    const own = await (await fetch(ticketUrl, { headers: { cookie: "__Host-fixit_session=valid" } })).json();
    assert.equal(own.data.items.length, 1);
    const queue = await (await fetch(ticketUrl + "?scope=available", { headers: { cookie: "__Host-fixit_session=agent" } })).json();
    assert.equal(queue.data.items.length, 2);
    assert.ok(queue.data.items.every((item) => !("description" in item) && !("reporterId" in item)));
    await owner.query("UPDATE tickets.support_tickets SET created_at = '2026-01-01T00:00:00.123456Z'");
    const first = await (await fetch(ticketUrl + "?limit=1&sort=created_asc", { headers: { cookie: "__Host-fixit_session=admin" } })).json();
    assert.equal(first.data.items.length, 1);
    assert.ok(first.data.page.nextCursor);
    const second = await (await fetch(ticketUrl + "?limit=1&sort=created_asc&cursor=" + first.data.page.nextCursor, { headers: { cookie: "__Host-fixit_session=admin" } })).json();
    assert.equal(second.data.items.length, 1);
    assert.notEqual(first.data.items[0].id, second.data.items[0].id);
    assert.equal((await fetch(ticketUrl + "?limit=1&sort=created_asc&cursor=" + first.data.page.nextCursor, { headers: { cookie: "__Host-fixit_session=valid" } })).status, 422);
    assert.equal((await fetch(ticketUrl + "?scope=available", { headers: { cookie: "__Host-fixit_session=valid" } })).status, 403);
    assert.equal((await fetch(ticketUrl + "?limit=51", { headers: { cookie: "__Host-fixit_session=admin" } })).status, 422);
    await owner.query("INSERT INTO tickets.support_tickets (reporter_id, assignee_id, category_code, title, description, reporter_urgency, status) VALUES ('550e8400-e29b-41d4-a716-446655440002', '550e8400-e29b-41d4-a716-446655440003', 'NETWORK', 'Assigned', 'Synthetic', 'NORMAL', 'ASSIGNED')");
    const assigned = await (await fetch(ticketUrl, { headers: { cookie: "__Host-fixit_session=agent" } })).json();
    assert.equal(assigned.data.items.length, 1);
    assert.equal(assigned.data.items[0].title, "Assigned");
    assert.equal((await fetch(ticketUrl + "/" + assigned.data.items[0].id, { headers: { cookie: "__Host-fixit_session=agent" } })).status, 200);
    await owner.query("REVOKE INSERT ON tickets.outbox FROM tickets_runtime");
    const rolledBack = await fetch(ticketUrl, { method: "POST", headers, body: JSON.stringify(ticket) });
    assert.equal(rolledBack.status, 503);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM tickets.support_tickets")).rows[0].count, 3);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM tickets.ticket_timeline")).rows[0].count, 1);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM tickets.outbox")).rows[0].count, 1);
    const invalid = await fetch(ticketUrl, { method: "POST", headers, body: JSON.stringify({ ...ticket, reporterId: "550e8400-e29b-41d4-a716-446655440002" }) });
    assert.equal(invalid.status, 422);
    await new Promise((resolve) => auth.close(resolve));
    auth = undefined;
    assert.equal((await fetch(url, { headers: { cookie: "__Host-fixit_session=valid" } })).status, 503);
  } finally {
    await new Promise((resolve) => server ? server.close(resolve) : resolve());
    await new Promise((resolve) => auth ? auth.close(resolve) : resolve());
    await pool?.end();
    await owner?.end();
    await cleanup();
  }
});
