import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { crc32, deflateSync } from "node:zlib";
import pg from "pg";
import { createApp } from "../dist/app.js";
import { FileAttachmentStorage } from "../dist/attachment-storage.js";
import { openTicketsDatabase } from "../dist/database.js";
import { createDatabase, cleanup } from "./fixtures/postgres17.mjs";

const MiB = 1024 * 1024;

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length);
  chunk.write(type, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return chunk;
}

const png = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  pngChunk("IHDR", Buffer.from("00000001000000010802000000", "hex")),
  pngChunk("IDAT", deflateSync(Buffer.from([0, 123, 50, 0]))),
  pngChunk("IEND", Buffer.alloc(0))
]);

function box(type, ...chunks) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + chunks.reduce((size, chunk) => size + chunk.length, 0));
  header.write(type, 4);
  return Buffer.concat([header, ...chunks]);
}

function testVideo(size) {
  const handler = Buffer.alloc(24);
  handler.write("vide", 8);
  const sample = Buffer.alloc(78);
  sample.writeUInt16BE(1, 6);
  sample.writeUInt16BE(1920, 24);
  sample.writeUInt16BE(1080, 26);
  const description = box("stsd", Buffer.from("0000000000000001", "hex"), box("avc1", sample));
  const media = box("mdia", box("hdlr", handler), box("minf", box("stbl", description)));
  const head = Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0")), box("moov", box("trak", media))]);
  return Buffer.concat([head, box("mdat", Buffer.alloc(size - head.length - 8))]);
}

test("private attachments enforce access, quotas, concurrency and compensation in PostgreSQL 17", { timeout: 120000 }, async (t) => {
  const fixture = await createDatabase();
  const teardown = [cleanup];
  t.after(async () => {
    const errors = [];
    for (const clean of teardown.reverse()) {
      try { await clean(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Attachment fixture cleanup failed.");
  });
  const directory = await mkdtemp(join(tmpdir(), "fixit-tickets-attachments-"));
  teardown.push(() => rm(directory, { recursive: true, force: true }));
  const storage = new FileAttachmentStorage(directory);
  let failedStorage = false;
  let failedRemoval = false;
  let pauseWrite;
  const removedKeys = new Set();
  const attachmentStorage = {
    async put(key, bytes) {
      if (failedStorage) throw new Error("Synthetic write failure");
      if (pauseWrite) {
        const pause = pauseWrite;
        pauseWrite = undefined;
        pause.enter.resolve(key);
        await pause.exit.promise;
      }
      await storage.put(key, bytes);
    },
    open: (key, size) => storage.open(key, size),
    async remove(key) {
      if (failedRemoval) throw new Error("Synthetic delete failure");
      await storage.remove(key);
      removedKeys.add(key);
    }
  };
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma.config.ts"], {
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, DATABASE_URL: fixture.ownerUrl }, timeout: 60000
  });
  const owner = new pg.Client({ connectionString: fixture.ownerUrl });
  await owner.connect();
  teardown.push(() => owner.end());
  await owner.query(`GRANT USAGE ON SCHEMA tickets TO tickets_runtime;
    GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA tickets TO tickets_runtime`);
  const pool = openTicketsDatabase(fixture.runtimeUrl);
  teardown.push(() => pool.end());
  const identities = new Map();
  for (const [name, role] of [["reporter", "REPORTER"], ["other", "REPORTER"],
    ["agent", "SUPPORT_AGENT"], ["former", "SUPPORT_AGENT"], ["admin", "ADMIN"]]) {
    const userId = randomUUID();
    await owner.query(`INSERT INTO auth.users (id, email, display_name, role, account_status, password_hash)
      VALUES ($1, $2, 'Synthetic', $3, 'ACTIVE', 'synthetic')`, [userId, name + "@example.test", role]);
    identities.set(name, { userId, role });
  }
  const makeTicket = async () => {
    const result = await owner.query(`INSERT INTO tickets.support_tickets
      (reporter_id, category_code, title, description, reporter_urgency)
      VALUES ($1, 'NETWORK', 'Synthetic', 'Synthetic', 'NORMAL') RETURNING id`, [identities.get("reporter").userId]);
    return result.rows[0].id;
  };
  const auth = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const { sessionToken, csrfToken } = JSON.parse(body);
    const subject = identities.get(sessionToken);
    res.setHeader("Content-Type", "application/json");
    const data = subject ? { active: true, subject, expiresAt: "2099-01-01T00:00:00Z" } : { active: false };
    if (csrfToken !== undefined) data.csrfValid = Boolean(subject) && csrfToken === "synthetic-" + sessionToken;
    res.end(JSON.stringify({ data, requestId: randomUUID() }));
  }).listen(0, "127.0.0.1");
  teardown.push(() => new Promise((resolve) => {
    auth.close(resolve);
    auth.closeAllConnections();
  }));
  await new Promise((resolve) => auth.once("listening", resolve));
  const publicOrigin = "https://fixit.invalid";
  const server = createApp(() => false, { database: pool, attachmentStorage,
    authUrl: `http://127.0.0.1:${auth.address().port}`, serviceToken: randomUUID(), publicOrigin }).listen(0, "127.0.0.1");
  teardown.push(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  await new Promise((resolve) => server.once("listening", resolve));
  const endpoint = (id) => `http://127.0.0.1:${server.address().port}/api/v1/tickets/${id}/attachments`;
  const cookie = (user) => "__Host-fixit_session=" + user;
  function upload(id, version, { user = "reporter", bytes = png, type = "image/png", headers = {}, extra = false } = {}) {
    const body = new FormData();
    body.set("file", new Blob([bytes], { type }), "../../unsafe.png");
    body.set("expectedVersion", version);
    if (extra) body.append("expectedVersion", version);
    return fetch(endpoint(id), { method: "POST", headers: {
      cookie: cookie(user), origin: publicOrigin, "x-csrf-token": "synthetic-" + user, ...headers
    }, body }).catch((cause) => {
      throw new Error(`Upload request failed for ${type} (${bytes.length} bytes)`, { cause });
    });
  }
  const download = (ticket, id, user) => fetch(endpoint(ticket) + "/" + id, { headers: user ? { cookie: cookie(user) } : {} });
  const ticket = await makeTicket();
  const otherTicket = await makeTicket();
  assert.equal((await upload(ticket, 1, { user: "revoked" })).status, 401);
  assert.equal((await upload(ticket, 1, { user: "admin" })).status, 403);
  assert.equal((await upload(ticket, 1, { user: "other" })).status, 404);
  assert.equal((await upload(ticket, 1, { headers: { "x-csrf-token": "synthetic-other" } })).status, 403);
  assert.equal((await upload(ticket, 1, { headers: { origin: "https://wrong.invalid" } })).status, 403);
  assert.equal((await upload(ticket, 1, { extra: true })).status, 422);
  assert.equal((await upload(ticket, 1, { bytes: png.subarray(0, 8) })).status, 415);
  assert.equal((await upload(ticket, 1, { type: "image/jpeg" })).status, 415);
  assert.equal((await upload(ticket, 1, { bytes: Buffer.alloc(5 * MiB + 1) })).status, 413);
  assert.equal((await upload(ticket, 1, { bytes: Buffer.alloc(25 * MiB + 1), type: "video/mp4" })).status, 413);
  assert.deepEqual(await readdir(directory), []);
  const first = await upload(ticket, 1);
  assert.equal(first.status, 201, first.ok ? undefined : await first.clone().text());
  const { data, requestId } = await first.json();
  assert.equal(data.version, 2);
  assert.match(requestId, /^[\da-f-]{36}$/);
  const evidence = data.attachments[0];
  assert.deepEqual(Object.keys(evidence).sort(), ["contentType", "id", "sizeBytes", "ticketId", "uploadedAt"]);
  const row = await owner.query("SELECT sha256_hex, storage_key FROM tickets.ticket_attachments WHERE id = $1", [evidence.id]);
  assert.equal(row.rows[0].sha256_hex, createHash("sha256").update(png).digest("hex"));
  const privateKey = row.rows[0].storage_key;
  assert.ok((await readdir(directory)).includes(privateKey));
  assert.ok(!JSON.stringify(data).includes(privateKey));
  const events = await owner.query("SELECT event_type, ticket_version FROM tickets.ticket_timeline WHERE ticket_id = $1", [ticket]);
  assert.deepEqual(events.rows, [{ event_type: "ATTACHMENT_ADDED", ticket_version: 2 }]);
  assert.equal((await owner.query("SELECT id FROM tickets.outbox WHERE ticket_id = $1", [ticket])).rowCount, 0);
  assert.equal((await download(ticket, evidence.id)).status, 401);
  assert.equal((await download(ticket, evidence.id, "other")).status, 404);
  assert.equal((await download(otherTicket, evidence.id, "reporter")).status, 404);
  assert.equal((await download(ticket, "..%2f..%2f", "reporter")).status, 404);
  for (const user of ["reporter", "admin"]) {
    const response = await download(ticket, evidence.id, user);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("content-disposition"), 'attachment; filename="evidence.png"');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  }
  await owner.query("UPDATE tickets.support_tickets SET status = 'ASSIGNED', assignee_id = $2 WHERE id = $1", [ticket, identities.get("former").userId]);
  const prior = await download(ticket, evidence.id, "former");
  assert.equal(prior.status, 200);
  await prior.arrayBuffer();
  await owner.query("UPDATE tickets.support_tickets SET assignee_id = $2 WHERE id = $1", [ticket, identities.get("agent").userId]);
  assert.equal((await download(ticket, evidence.id, "former")).status, 404);
  assert.equal((await (await download(ticket, evidence.id, "agent")).arrayBuffer()).byteLength, png.length);
  assert.equal((await upload(ticket, 2)).status, 409);

  const countTicket = await makeTicket();
  for (let version = 1; version <= 4; version++) assert.equal((await upload(countTicket, version)).status, 201);
  const pause = { enter: Promise.withResolvers(), exit: Promise.withResolvers() };
  pauseWrite = pause;
  const firstClaim = upload(countTicket, 5);
  let secondClaim;
  try {
    await Promise.race([pause.enter.promise, firstClaim.then(() => assert.fail("Upload did not reach storage"))]);
    secondClaim = upload(countTicket, 5);
    let waiting = false;
    for (let attempt = 0; attempt < 60 && !waiting; attempt++) {
      const locks = await owner.query(`SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING (pid)
        WHERE NOT l.granted AND a.usename = 'tickets_runtime' AND a.datname = current_database()`);
      waiting = locks.rowCount > 0;
      if (!waiting) await delay(25);
    }
    assert.ok(waiting, "The second PostgreSQL connection waited for the ticket lock");
  } finally {
    pause.exit.resolve();
  }
  const race = await Promise.all([firstClaim, secondClaim]);
  assert.deepEqual(race.map((response) => response.status).sort(), [201, 409]);
  assert.equal((await upload(countTicket, 6)).status, 409);
  const count = await owner.query("SELECT count(*)::int FROM tickets.ticket_attachments WHERE ticket_id = $1", [countTicket]);
  assert.equal(count.rows[0].count, 5);

  for (const reason of ["database termination", "storage deadline"]) {
    await t.test(`${reason} releases the upload lock and cleans up a late file`, async () => {
      const interrupted = await makeTicket();
      const pause = { enter: Promise.withResolvers(), exit: Promise.withResolvers() };
      pauseWrite = pause;
      const first = upload(interrupted, 1);
      let key;
      try {
        key = await Promise.race([pause.enter.promise, first.then(() => assert.fail("Upload did not reach storage"))]);
        if (reason === "database termination") {
          const admin = new pg.Client({ connectionString: fixture.adminUrl });
          await admin.connect();
          try {
            const result = await admin.query(`SELECT pg_terminate_backend(pid, 1000) AS stopped
              FROM pg_stat_activity WHERE usename = 'tickets_runtime' AND state = 'idle in transaction'`);
            assert.deepEqual(result.rows, [{ stopped: true }]);
          } finally {
            await admin.end();
          }
        }
        const limit = reason === "database termination" ? 2000 : 4500;
        const response = await Promise.race([first, delay(limit, undefined, { ref: false }).then(() => assert.fail("Upload waited for stalled storage"))]);
        assert.equal(response.status, 503);
        const failure = await response.json();
        assert.equal(failure.error.code, "DEPENDENCY_UNAVAILABLE");
        assert.match(failure.requestId, /^[\da-f-]{36}$/);
        assert.equal((await owner.query("SELECT version FROM tickets.support_tickets WHERE id = $1", [interrupted])).rows[0].version, 1);
        assert.equal((await owner.query("SELECT id FROM tickets.ticket_attachments WHERE ticket_id = $1", [interrupted])).rowCount, 0);
        assert.equal((await upload(interrupted, 1)).status, 201);
      } finally {
        pause.exit.resolve();
      }
      for (let attempt = 0; attempt < 80; attempt++) {
        if (removedKeys.has(key)) break;
        await delay(25);
      }
      assert.ok(removedKeys.has(key));
      assert.ok(!(await readdir(directory)).includes(key));
      assert.equal((await owner.query("SELECT id FROM tickets.ticket_attachments WHERE ticket_id = $1", [interrupted])).rowCount, 1);
      assert.equal((await owner.query("SELECT id FROM tickets.ticket_timeline WHERE ticket_id = $1", [interrupted])).rowCount, 1);
    });
  }

  const videoTicket = await makeTicket();
  const maxVideo = testVideo(25 * MiB);
  assert.equal((await upload(videoTicket, 1, { bytes: maxVideo, type: "video/mp4" })).status, 201);
  assert.equal((await upload(videoTicket, 2, { bytes: maxVideo, type: "video/mp4" })).status, 201);
  assert.equal((await upload(videoTicket, 3, { bytes: testVideo(256), type: "video/mp4" })).status, 409);
  assert.equal((await upload(videoTicket, 3)).status, 413);

  const rollbackTicket = await makeTicket();
  const files = (await readdir(directory)).sort();
  assert.equal(files.length, 10);
  failedStorage = true;
  assert.equal((await upload(rollbackTicket, 1)).status, 503);
  failedStorage = false;
  await owner.query("REVOKE INSERT ON tickets.ticket_timeline FROM tickets_runtime");
  assert.equal((await upload(rollbackTicket, 1)).status, 503);
  assert.deepEqual((await readdir(directory)).sort(), files);
  const rollback = await owner.query(`SELECT version, (SELECT count(*)::int FROM tickets.ticket_attachments WHERE ticket_id = $1) AS attachments,
    (SELECT count(*)::int FROM tickets.ticket_timeline WHERE ticket_id = $1) AS events
    FROM tickets.support_tickets WHERE id = $1`, [rollbackTicket]);
  assert.deepEqual(rollback.rows[0], { version: 1, attachments: 0, events: 0 });
  const diagnostic = t.mock.method(console, "error", () => {});
  failedRemoval = true;
  const uncompensated = await upload(rollbackTicket, 1);
  assert.equal(uncompensated.status, 503);
  const failure = await uncompensated.json();
  const leftovers = (await readdir(directory)).filter((key) => !files.includes(key));
  assert.equal(leftovers.length, 1);
  assert.deepEqual(diagnostic.mock.calls.map((call) => call.arguments), [
    ["Attachment cleanup requires reconciliation", { requestId: failure.requestId, key: leftovers[0] }]
  ]);
  assert.equal((await owner.query("SELECT id FROM tickets.ticket_attachments WHERE storage_key = $1", leftovers)).rowCount, 0);
  await storage.remove(leftovers[0]);
  await storage.remove(privateKey);
  assert.equal((await download(ticket, evidence.id, "reporter")).status, 503);
});
