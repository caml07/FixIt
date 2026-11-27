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
    await owner.query("INSERT INTO auth.users (id, email, display_name, role, account_status, password_hash) VALUES ('550e8400-e29b-41d4-a716-446655440005', 'agent2@example.test', 'Synthetic', 'SUPPORT_AGENT', 'ACTIVE', 'synthetic')");
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
          agent2: ["550e8400-e29b-41d4-a716-446655440005", "SUPPORT_AGENT"],
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
      assert.equal((await fetch(`http://127.0.0.1:${failClosed.address().port}/api/v1/tickets/${createdBody.data.id}/claim`, {
        method: "POST", headers: { ...headers, cookie: "__Host-fixit_session=agent" }
      })).status, 403);
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
    await owner.query("GRANT INSERT ON tickets.outbox TO tickets_runtime");
    const ticketPath = ticketUrl + "/" + createdBody.data.id;
    const mutate = (path, method, actor, payload, extra = {}) => fetch(path, {
      method, headers: { ...headers, cookie: "__Host-fixit_session=" + actor, ...extra },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) })
    });
    assert.equal((await mutate(ticketPath, "PATCH", "expired", { expectedVersion: 1, title: "No" })).status, 401);
    assert.equal((await mutate(ticketPath + "/claim", "POST", "revoked")).status, 401);
    assert.equal((await mutate(ticketPath, "PATCH", "other", { expectedVersion: 1, title: "No" })).status, 404);
    assert.equal((await mutate(ticketPath, "PATCH", "valid", { expectedVersion: 1 })).status, 422);
    assert.equal((await mutate(ticketPath, "PATCH", "valid", { expectedVersion: 1, effectivePriority: "P1_CRITICAL" })).status, 422);
    assert.equal((await mutate(ticketPath, "PATCH", "valid", { expectedVersion: 1, category: "HARDWARE" })).status, 422);
    assert.equal((await mutate(ticketPath, "PATCH", "valid", { expectedVersion: 1, title: "No" }, { origin: "https://evil.invalid" })).status, 403);
    const edited = await mutate(ticketPath, "PATCH", "valid", { expectedVersion: 1, reporterUrgency: "LOW", title: "Updated" });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).data.version, 2);
    assert.equal((await mutate(ticketPath, "PATCH", "valid", { expectedVersion: 1, title: "Stale" })).status, 409);
    assert.equal((await mutate(ticketPath + "/claim", "POST", "valid")).status, 403);
    await owner.query("BEGIN");
    await owner.query("SELECT id FROM tickets.support_tickets WHERE id = $1 FOR UPDATE", [createdBody.data.id]);
    const acquired = new Set();
    const recordConnection = (client) => acquired.add(client);
    pool.on("acquire", recordConnection);
    const claimRequests = [
      mutate(ticketPath + "/claim", "POST", "agent"),
      mutate(ticketPath + "/claim", "POST", "agent2")
    ];
    try {
      for (let attempt = 0; attempt < 200 && acquired.size < 2; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(acquired.size, 2);
    } finally {
      pool.off("acquire", recordConnection);
      await owner.query("COMMIT");
    }
    const claims = await Promise.all(claimRequests);
    assert.deepEqual(claims.map((result) => result.status).sort(), [200, 409]);
    const winner = claims[0].status === 200 ? "agent" : "agent2";
    const loser = winner === "agent" ? "agent2" : "agent";
    assert.equal((await mutate(ticketPath + "/status", "PATCH", "valid", { expectedVersion: 3, to: "IN_PROGRESS" })).status, 403);
    assert.equal((await mutate(ticketPath + "/status", "PATCH", winner, { expectedVersion: 3, to: "IN_PROGRESS" })).status, 409);
    assert.equal((await mutate(ticketPath + "/priority", "PATCH", winner, { expectedVersion: 2, priority: "P2_HIGH" })).status, 409);
    assert.equal((await mutate(ticketPath + "/status", "PATCH", winner, { expectedVersion: 2, to: "IN_PROGRESS" })).status, 409);
    assert.equal((await mutate(ticketPath + "/status", "PATCH", loser, { expectedVersion: 3, to: "IN_PROGRESS" })).status, 404);
    assert.equal((await mutate(ticketPath + "/priority", "PATCH", winner, { expectedVersion: 3, priority: "P2_HIGH" }, { "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await mutate(ticketPath + "/priority", "PATCH", "valid", { expectedVersion: 3, priority: "P2_HIGH" })).status, 403);
    assert.equal((await mutate(ticketPath + "/priority", "PATCH", winner, { expectedVersion: 3, priority: "HIGH" })).status, 422);
    assert.equal((await mutate(ticketPath + "/priority", "PATCH", loser, { expectedVersion: 3, priority: "P2_HIGH" })).status, 403);
    assert.equal((await mutate(ticketPath + "/priority", "PATCH", winner, { expectedVersion: 3, priority: "P2_HIGH" })).status, 200);
    assert.equal((await mutate(ticketPath + "/priority", "PATCH", winner, { expectedVersion: 4, priority: "P3_NORMAL" })).status, 422);
    assert.equal((await mutate(ticketPath + "/status", "PATCH", winner, { expectedVersion: 4, to: "RESOLVED" })).status, 409);
    assert.equal((await mutate(ticketPath + "/status", "PATCH", winner, { expectedVersion: 4, to: "IN_PROGRESS" })).status, 200);
    assert.equal((await mutate(ticketPath + "/status", "PATCH", winner, { expectedVersion: 5, to: "RESOLVED" })).status, 200);
    assert.equal((await mutate(ticketPath + "/status", "PATCH", "valid", { expectedVersion: 6, to: "CLOSED" })).status, 200);
    const audit = await owner.query("SELECT event_type, ticket_version FROM tickets.ticket_timeline WHERE ticket_id = $1 ORDER BY ticket_version", [createdBody.data.id]);
    assert.deepEqual(audit.rows.map((row) => row.event_type), ["CREATED", "EDITED", "CLAIMED", "PRIORITY_UPDATED", "STATUS_CHANGED", "STATUS_CHANGED", "STATUS_CHANGED"]);
    const editAudit = await owner.query("SELECT from_urgency, to_urgency FROM tickets.ticket_timeline WHERE ticket_id = $1 AND event_type = 'EDITED'", [createdBody.data.id]);
    assert.deepEqual(editAudit.rows[0], { from_urgency: "HIGH", to_urgency: "LOW" });
    const priorityAudit = await owner.query("SELECT from_priority, to_priority FROM tickets.ticket_timeline WHERE ticket_id = $1 AND event_type = 'PRIORITY_UPDATED'", [createdBody.data.id]);
    assert.deepEqual(priorityAudit.rows[0], { from_priority: null, to_priority: "P2_HIGH" });
    const published = await owner.query("SELECT event_type FROM tickets.outbox WHERE ticket_id = $1 ORDER BY aggregate_version", [createdBody.data.id]);
    assert.deepEqual(published.rows.map((row) => row.event_type), ["ticket.created.v1", "ticket.claimed.v1", "ticket.status-changed.v1", "ticket.status-changed.v1", "ticket.status-changed.v1"]);
    const claimAudit = await owner.query("SELECT count(*)::int AS count FROM tickets.ticket_timeline WHERE ticket_id = $1 AND event_type = 'CLAIMED'", [createdBody.data.id]);
    assert.equal(claimAudit.rows[0].count, 1);
    assert.equal((await mutate(ticketPath, "PATCH", "valid", { expectedVersion: 7, title: "Late edit" })).status, 409);
    assert.equal((await mutate(ticketPath + "/priority", "PATCH", winner, { expectedVersion: 7, priority: "P1_CRITICAL", reason: "Late change" })).status, 409);
    assert.equal((await mutate(ticketPath + "/status", "PATCH", "valid", { expectedVersion: 7, to: "OPEN" })).status, 409);
    const fresh = await owner.query("INSERT INTO tickets.support_tickets (reporter_id, category_code, title, description, reporter_urgency) VALUES ($1, 'NETWORK', 'Rollback', 'Synthetic', 'NORMAL') RETURNING id", [createdBody.data.reporterId]);
    const freshPath = ticketUrl + "/" + fresh.rows[0].id;
    await owner.query("REVOKE INSERT ON tickets.outbox FROM tickets_runtime");
    assert.equal((await mutate(freshPath + "/claim", "POST", "agent")).status, 503);
    const unchanged = await owner.query("SELECT status, version, assignee_id FROM tickets.support_tickets WHERE id = $1", [fresh.rows[0].id]);
    assert.deepEqual(unchanged.rows[0], { status: "OPEN", version: 1, assignee_id: null });
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM tickets.ticket_timeline WHERE ticket_id = $1", [fresh.rows[0].id])).rows[0].count, 0);
    assert.equal((await owner.query("SELECT count(*)::int AS count FROM tickets.outbox WHERE ticket_id = $1", [fresh.rows[0].id])).rows[0].count, 0);
    await owner.query("GRANT INSERT ON tickets.outbox TO tickets_runtime");
    assert.equal((await mutate(freshPath + "/claim", "POST", "agent", undefined, { "x-csrf-token": "wrong" })).status, 403);
    assert.equal((await mutate(freshPath + "/status", "PATCH", "valid", { expectedVersion: 1, to: "CANCELLED" })).status, 200);
    assert.equal((await mutate(freshPath + "/claim", "POST", "agent")).status, 409);
    const adminTicket = await owner.query("INSERT INTO tickets.support_tickets (reporter_id, assignee_id, category_code, title, description, reporter_urgency, status) VALUES ($1, $2, 'NETWORK', 'Admin', 'Synthetic', 'NORMAL', 'ASSIGNED') RETURNING id", [createdBody.data.reporterId, "550e8400-e29b-41d4-a716-446655440003"]);
    const adminPath = ticketUrl + "/" + adminTicket.rows[0].id;
    assert.equal((await mutate(adminPath + "/priority", "PATCH", "admin", { expectedVersion: 1, priority: "P3_NORMAL" })).status, 200);
    assert.equal((await mutate(adminPath + "/priority", "PATCH", "admin", { expectedVersion: 2, priority: "P2_HIGH", reason: "Triage update" })).status, 200);
    const changedPriority = await owner.query("SELECT from_priority, to_priority, reason FROM tickets.ticket_timeline WHERE ticket_id = $1 AND ticket_version = 3", [adminTicket.rows[0].id]);
    assert.deepEqual(changedPriority.rows[0], { from_priority: "P3_NORMAL", to_priority: "P2_HIGH", reason: "Triage update" });
    assert.equal((await mutate(adminPath + "/status", "PATCH", "admin", { expectedVersion: 3, to: "IN_PROGRESS" })).status, 422);
    assert.equal((await mutate(adminPath + "/status", "PATCH", "admin", { expectedVersion: 3, to: "IN_PROGRESS", reason: "Covering absence" })).status, 200);
    const editRollback = await owner.query("INSERT INTO tickets.support_tickets (reporter_id, category_code, title, description, reporter_urgency) VALUES ($1, 'NETWORK', 'Before', 'Synthetic', 'NORMAL') RETURNING id", [createdBody.data.reporterId]);
    await owner.query("REVOKE INSERT ON tickets.ticket_timeline FROM tickets_runtime");
    assert.equal((await mutate(ticketUrl + "/" + editRollback.rows[0].id, "PATCH", "valid", { expectedVersion: 1, title: "After" })).status, 503);
    const afterRollback = await owner.query("SELECT title, version FROM tickets.support_tickets WHERE id = $1", [editRollback.rows[0].id]);
    assert.deepEqual(afterRollback.rows[0], { title: "Before", version: 1 });
    await owner.query("GRANT INSERT ON tickets.ticket_timeline TO tickets_runtime");
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
