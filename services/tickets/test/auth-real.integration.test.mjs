import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { crc32, deflateSync } from "node:zlib";
import pg from "pg";
import { createDatabase, cleanup } from "./fixtures/postgres17.mjs";

const authDir = process.env.FIXIT_PINNED_AUTH_DIR;
const origin = "https://fixit.integration.invalid";

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

async function until(check, message, timeout = 6000) {
  const end = Date.now() + timeout;
  do {
    if (await check()) return;
    await delay(25);
  } while (Date.now() < end);
  assert.fail(message);
}

async function freePort() {
  const s = createServer();
  await new Promise((resolve, reject) => s.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = s.address();
  await new Promise((resolve) => s.close(resolve));
  return port;
}

test("published Auth and Tickets processes enforce the 0.5.0 HTTP boundary", { skip: !authDir, timeout: 90000 }, async (t) => {
  const fixture = await createDatabase();
  const teardown = [cleanup];
  t.after(async () => {
    const results = [];
    for (const close of teardown.reverse()) {
      try { await close(); } catch (error) { results.push(error); }
    }
    if (results.length) throw new AggregateError(results, "Integration cleanup failed");
  });
  const env = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP };
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma.config.ts"], {
    env: { ...env, DATABASE_URL: fixture.ownerUrl }, timeout: 60000
  });
  const migrationOwner = new pg.Client({ connectionString: fixture.ownerUrl });
  const adminDb = new pg.Client({ connectionString: fixture.adminUrl });
  await migrationOwner.connect();
  teardown.push(() => migrationOwner.end());
  await adminDb.connect();
  teardown.push(() => adminDb.end());
  const authPassword = randomBytes(24).toString("hex");
  await adminDb.query(`CREATE ROLE auth_runtime LOGIN PASSWORD '${authPassword}'`);
  await migrationOwner.query(`GRANT USAGE ON SCHEMA auth TO auth_runtime;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA auth TO auth_runtime;
    GRANT USAGE ON SCHEMA tickets TO tickets_runtime;
    GRANT SELECT ON tickets.categories, tickets.ticket_attachments, tickets.ticket_timeline, tickets.outbox TO tickets_runtime;
    GRANT UPDATE (is_active) ON tickets.categories TO tickets_runtime;
    GRANT SELECT, INSERT, UPDATE ON tickets.support_tickets TO tickets_runtime;
    GRANT INSERT ON tickets.ticket_attachments, tickets.ticket_timeline, tickets.outbox TO tickets_runtime;
    GRANT UPDATE (attempts, published_at) ON tickets.outbox TO tickets_runtime`);
  const authDb = new URL(fixture.runtimeUrl);
  authDb.username = "auth_runtime";
  authDb.password = authPassword;
  for (const [url, table] of [[authDb.href, "tickets.support_tickets"], [fixture.runtimeUrl, "auth.users"]]) {
    const db = new pg.Client({ connectionString: url });
    await db.connect();
    try { await assert.rejects(db.query(`SELECT 1 FROM ${table} LIMIT 1`), { code: "42501" }); }
    finally { await db.end(); }
  }
  const requireAuth = createRequire(join(authDir, "package.json"));
  const password = randomBytes(32).toString("base64url");
  const hash = await requireAuth("argon2").hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  async function seed(role, status = "ACTIVE") {
    const person = { id: randomUUID(), email: `${randomUUID()}@example.test` };
    await migrationOwner.query(`INSERT INTO auth.users (id,email,display_name,role,account_status,password_hash,temporary_expires_at)
      VALUES ($1,$2,'Synthetic',$3,$4,$5,CASE WHEN $4='PENDING_PASSWORD_CHANGE' THEN now()+interval '1 hour' END)`,
    [person.id, person.email, role, status, hash]);
    return person;
  }
  const reporter = await seed("REPORTER"), outsider = await seed("REPORTER"), admin = await seed("ADMIN");
  const oldAgent = await seed("SUPPORT_AGENT"), newAgent = await seed("SUPPORT_AGENT");
  const pending = await seed("REPORTER", "PENDING_PASSWORD_CHANGE"), inactive = await seed("SUPPORT_AGENT", "DISABLED");
  const serviceToken = randomUUID(), chatToken = randomUUID();
  const scratch = await mkdtemp(join(tmpdir(), "fixit-real-auth-media-"));
  teardown.push(() => rm(scratch, { recursive: true, force: true }));
  async function launch(cwd, args, settings) {
    const child = spawn(process.execPath, args, { cwd, env: { ...env, ...settings }, stdio: "ignore" });
    const done = new Promise((resolve) => {
      child.once("exit", resolve);
      child.once("error", resolve);
    });
    const stop = async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await done;
    };
    teardown.push(stop);
    const port = settings.PORT ?? settings.AUTH_PORT;
    const url = `http://127.0.0.1:${port}`;
    await until(async () => {
      if (child.exitCode !== null) assert.fail("Service exited during startup");
      return (await fetch(url + "/health", { signal: AbortSignal.timeout(300) }).catch(() => null))?.ok;
    }, "Service did not become healthy", 12000);
    return { url, stop };
  }
  const auth = await launch(authDir, ["--import", "tsx", "services/auth/src/server.ts"], {
    AUTH_PORT: String(await freePort()), AUTH_DATABASE_URL: authDb.href, AUTH_PUBLIC_ORIGIN: origin, AUTH_CSRF_KEY: randomUUID(),
    AUTH_TICKETS_SERVICE_TOKEN: serviceToken, AUTH_CHAT_SERVICE_TOKEN: chatToken
  });
  const launchTickets = async (bearer) => launch(process.cwd(), ["dist/server.js"], {
    PORT: String(await freePort()), TICKETS_DATABASE_URL: fixture.runtimeUrl, AUTH_INTERNAL_URL: auth.url,
    TICKETS_AUTH_SERVICE_TOKEN: bearer, TICKETS_PUBLIC_ORIGIN: origin, TICKETS_ATTACHMENT_DIRECTORY: scratch
  });
  const tickets = await launchTickets(serviceToken);
  async function login(person) {
    const res = await fetch(auth.url + "/api/v1/auth/login", { method: "POST", headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ email: person.email, password }) });
    assert.equal(res.status, 200);
    const cookie = res.headers.get("set-cookie").split(";")[0];
    const csrfResponse = await fetch(auth.url + "/api/v1/auth/csrf", { headers: { cookie } });
    assert.equal(csrfResponse.status, 200);
    return { cookie, csrf: (await csrfResponse.json()).data.csrfToken };
  }
  const author = await login(reporter), other = await login(outsider), operator = await login(admin);
  const candidate = await login(newAgent), previous = await login(oldAgent), provisional = await login(pending);
  const call = (base, path, identity, method = "GET", body, extra = {}) => fetch(base + path, {
    method, headers: { cookie: identity.cookie, origin, "x-csrf-token": identity.csrf,
      ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}), ...extra },
    body: body instanceof FormData ? body : body && JSON.stringify(body), signal: AbortSignal.timeout(6500)
  });
  const payload = { title: "Synthetic", category: "NETWORK", description: "Integration fixture", reporterUrgency: "NORMAL" };
  const root = "/api/v1/tickets";
  const create = (identity, extra) => call(tickets.url, root, identity, "POST", payload, extra);
  async function status(response, expected, code) {
    assert.equal(response.status, expected);
    if (code) assert.equal((await response.json()).error.code, code);
    return response;
  }
  await status(await create(provisional), 401, "UNAUTHENTICATED");
  await status(await create(author, { "x-csrf-token": other.csrf }), 403, "FORBIDDEN");
  await status(await create(author, { "x-csrf-token": "" }), 403, "FORBIDDEN");
  await status(await create(author, { origin: "https://wrong.invalid" }), 403, "FORBIDDEN");
  await status(await create(author, { "sec-fetch-site": "cross-site" }), 403, "FORBIDDEN");
  assert.equal((await migrationOwner.query("SELECT 1 FROM tickets.support_tickets")).rowCount, 0);
  const created = await (await status(await create(author), 201)).json();
  const path = root + "/" + created.data.id;
  const form = new FormData();
  form.set("expectedVersion", "1");
  form.set("file", new Blob([Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", Buffer.from("00000001000000010802000000", "hex")),
    pngChunk("IDAT", deflateSync(Buffer.from([0, 123, 50, 0]))),
    pngChunk("IEND", Buffer.alloc(0))
  ])], { type: "image/png" }), "evidence.png");
  await status(await call(tickets.url, path + "/attachments", { ...author, csrf: other.csrf }, "POST", form), 403);
  await status(await call(tickets.url, path + "/attachments", author, "POST", form), 201);
  const timeline = (identity, query = "") => call(tickets.url, path + "/events" + query, identity);
  const page = (await (await status(await timeline(author, "?limit=1"), 200)).json()).data;
  assert.equal(page.items[0].eventType, "CREATED");
  assert.ok(page.nextCursor);
  const next = (await (await status(await timeline(operator, "?cursor=" + page.nextCursor), 200)).json()).data;
  assert.deepEqual(next.items.map((item) => item.eventType), ["ATTACHMENT_ADDED"]);
  assert.equal(next.nextCursor, null);
  for (const query of ["?limit=", "?limit=0", "?limit=101", "?limit=1.5", "?limit=1&limit=1", "?limit[]=1", "?cursor=bad", "?cursor="]) {
    await status(await timeline(author, query), 422, "VALIDATION_ERROR");
  }
  for (const cursor of [[randomUUID(), 1], [created.data.id, 999]]) {
    await status(await timeline(author, "?cursor=" + Buffer.from(JSON.stringify(cursor)).toString("base64url")),
      422, "VALIDATION_ERROR");
  }
  await status(await timeline(other, "?limit=invalid"), 404, "NOT_FOUND");
  await status(await call(tickets.url, path + "/claim", previous, "POST"), 200);
  await status(await timeline(previous), 200);
  const assigned = path + "/assignee";
  const assign = (assigneeId, service = tickets) => call(service.url, assigned, operator, "PATCH",
    { assigneeId, expectedVersion: 3, reason: "Integration reassignment" });
  await status(await assign(inactive.id), 409, "ASSIGNEE_INELIGIBLE");
  const wrongBearer = await launchTickets(chatToken);
  await status(await assign(newAgent.id, wrongBearer), 503, "DEPENDENCY_UNAVAILABLE");
  await wrongBearer.stop();
  const state = async () => (await migrationOwner.query(`SELECT version, assignee_id,
    (SELECT count(*)::int FROM tickets.ticket_timeline WHERE ticket_id=$1) AS timeline,
    (SELECT count(*)::int FROM tickets.outbox WHERE ticket_id=$1) AS outbox FROM tickets.support_tickets WHERE id=$1`,
    [created.data.id])).rows[0];
  assert.deepEqual(await state(), { version: 3, assignee_id: oldAgent.id, timeline: 3, outbox: 2 });
  await migrationOwner.query("BEGIN");
  let racing;
  try {
    await migrationOwner.query("SELECT id FROM tickets.support_tickets WHERE id=$1 FOR UPDATE", [created.data.id]);
    racing = assign(newAgent.id);
    await until(async () => (await adminDb.query(`SELECT 1 FROM pg_stat_activity
      WHERE usename='tickets_runtime' AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE%'`)).rowCount > 0,
    "Reassignment did not wait after its real eligibility check", 1400);
    await status(await call(auth.url, "/api/v1/admin/users/" + newAgent.id + "/disable", operator, "POST"), 204);
  } finally {
    await migrationOwner.query("ROLLBACK");
    if (racing) await status(await racing, 200);
  }
  assert.deepEqual(await state(), { version: 4, assignee_id: newAgent.id, timeline: 4, outbox: 3 });
  await status(await timeline(candidate), 401, "UNAUTHENTICATED");
  await status(await call(tickets.url, path + "/status", candidate, "PATCH", { to: "IN_PROGRESS", expectedVersion: 4 }), 401);
  await status(await timeline(previous), 404, "NOT_FOUND");
  await status(await call(auth.url, "/api/v1/auth/logout", other, "POST"), 204);
  await status(await create(other), 401, "UNAUTHENTICATED");
  const expired = await login(outsider);
  const digest = createHash("sha256").update(expired.cookie.split("=")[1]).digest("hex");
  await migrationOwner.query("UPDATE auth.sessions SET expires_at=now() WHERE token_hash=$1", [digest]);
  await status(await create(expired), 401, "UNAUTHENTICATED");
  const idle = await login(outsider);
  const idleDigest = createHash("sha256").update(idle.cookie.split("=")[1]).digest("hex");
  await migrationOwner.query("UPDATE auth.sessions SET last_seen_at=now()-interval '1 hour' WHERE token_hash=$1", [idleDigest]);
  await status(await create(idle), 401, "UNAUTHENTICATED");
  await auth.stop();
  await status(await create(author), 503, "DEPENDENCY_UNAVAILABLE");
  assert.deepEqual(await state(), { version: 4, assignee_id: newAgent.id, timeline: 4, outbox: 3 });
  assert.equal((await migrationOwner.query("SELECT 1 FROM tickets.support_tickets")).rowCount, 1);
});
