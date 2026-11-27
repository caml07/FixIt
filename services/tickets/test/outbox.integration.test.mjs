import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { AckPolicy, RetentionPolicy, StorageType, jetstream, jetstreamManager } from "@nats-io/jetstream";
import { connect } from "@nats-io/transport-node";
import pg from "pg";
import { openOutboxDatabase } from "../dist/database.js";
import { createJetStreamPublisher } from "../dist/jetstream-publisher.js";
import { startOutboxWorker } from "../dist/outbox-worker.js";
import { createJetStreamFixture } from "./fixtures/jetstream.mjs";
import { createDatabase, cleanup } from "./fixtures/postgres17.mjs";

const stream = "FIXIT_TICKET_EVENTS";

async function eventually(check, message) {
  const deadline = Date.now() + 10_000;
  do {
    const result = await check();
    if (result) return result;
    await delay(50);
  } while (Date.now() < deadline);
  assert.fail(message);
}

test("transactional outbox delivery against disposable PostgreSQL 17 and JetStream", { timeout: 150_000 }, async (t) => {
  const database = await createDatabase();
  const teardown = [cleanup];
  t.after(async () => {
    const failures = [];
    for (const dispose of teardown.reverse()) {
      try { await dispose(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, "Outbox fixture teardown failed");
  });
  const broker = await createJetStreamFixture();
  teardown.push(broker.cleanup);
  const config = { endpoint: broker.endpoint, token: broker.token, tls: false };
  const connection = await eventually(() => connect({
    servers: broker.endpoint, token: broker.token, timeout: 500, reconnect: false
  }).catch(() => undefined), "Local NATS did not start");
  teardown.push(() => connection.close());
  const manager = await jetstreamManager(connection);
  await manager.streams.add({ name: stream, subjects: ["fixit.ticket.*.v1"], retention: RetentionPolicy.Limits,
    storage: StorageType.File, max_bytes: 1024 * 1024, max_age: 60 * 60 * 1e9, duplicate_window: 120 * 1e9 });
  await manager.consumers.add(stream, { durable_name: "chat-ticket-projection-v1", ack_policy: AckPolicy.Explicit });
  const consumer = await jetstream(connection).consumers.get(stream, "chat-ticket-projection-v1");
  async function expectConsumed(event) {
    const msg = await consumer.next({ expires: 2000 });
    assert.ok(msg);
    assert.equal(msg.subject, `fixit.${event.type}`);
    assert.equal(msg.headers.get("Nats-Msg-Id"), event.eventId);
    assert.deepEqual(msg.json(), event);
    assert.ok(await msg.ackAck());
  }
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma.config.ts"], {
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, DATABASE_URL: database.ownerUrl }, timeout: 60_000
  });
  const owner = new pg.Client({ connectionString: database.ownerUrl });
  await owner.connect();
  teardown.push(() => owner.end());
  await owner.query(`GRANT USAGE ON SCHEMA tickets TO tickets_runtime;
    GRANT SELECT, UPDATE (attempts, published_at) ON tickets.outbox TO tickets_runtime`);
  const reporter = randomUUID();
  const agent = randomUUID();
  const nextAgent = randomUUID();
  await owner.query(`INSERT INTO auth.users (id, email, display_name, role, account_status, password_hash)
    VALUES ($1, 'outbox-reporter@example.test', 'Synthetic', 'REPORTER', 'ACTIVE', 'synthetic'),
           ($2, 'outbox-agent@example.test', 'Synthetic', 'SUPPORT_AGENT', 'ACTIVE', 'synthetic'),
           ($3, 'outbox-agent2@example.test', 'Synthetic', 'SUPPORT_AGENT', 'ACTIVE', 'synthetic')`, [reporter, agent, nextAgent]);
  async function ticket() {
    const { rows } = await owner.query(`INSERT INTO tickets.support_tickets
      (reporter_id, category_code, title, description, reporter_urgency)
      VALUES ($1, 'NETWORK', 'Synthetic', 'Synthetic', 'NORMAL') RETURNING id`, [reporter]);
    return rows[0].id;
  }
  async function seed(ticketId, version = 1, kind = "created", fields = { reporterId: reporter }) {
    const type = `ticket.${kind}.v1`;
    const timeline = { created: "CREATED", claimed: "CLAIMED", reassigned: "REASSIGNED", "status-changed": "STATUS_CHANGED" };
    const event = { eventId: randomUUID(), type, schemaVersion: 1, aggregateId: ticketId, aggregateVersion: version,
      occurredAt: new Date().toISOString(), correlationId: randomUUID(), payload: { ticketId, ...fields } };
    await owner.query("BEGIN");
    try {
      await owner.query(`INSERT INTO tickets.ticket_timeline (ticket_id, actor_user_id, event_type, ticket_version)
        VALUES ($1, $2, $3, $4)`, [ticketId, reporter, timeline[kind], version]);
      await owner.query(`INSERT INTO tickets.outbox (id, ticket_id, aggregate_version, event_type, payload)
        VALUES ($1, $2, $3, $4, $5)`, [event.eventId, ticketId, version, type, JSON.stringify(event)]);
      await owner.query("COMMIT");
    } catch (error) {
      await owner.query("ROLLBACK");
      throw error;
    }
    return event;
  }
  async function state(event) {
    const { rows } = await owner.query("SELECT published_at, attempts FROM tickets.outbox WHERE id = $1", [event.eventId]);
    return rows[0];
  }
  function start(caseContext, publisher = createJetStreamPublisher(config)) {
    const pool = openOutboxDatabase(database.runtimeUrl);
    const worker = startOutboxWorker(pool, publisher);
    caseContext.after(async () => {
      try { await worker.stop(); } finally { await pool.end(); }
    });
    return worker;
  }

  await t.test("publishes contracted subjects, payloads, and IDs in ticket version order", async (ct) => {
    const id = await ticket();
    const events = [
      await seed(id),
      await seed(id, 2, "claimed", { assigneeId: agent }),
      await seed(id, 3, "reassigned", { previousAssigneeId: agent, assigneeId: nextAgent }),
      await seed(id, 4, "status-changed", { from: "IN_PROGRESS", to: "RESOLVED" })
    ];
    start(ct);
    for (const event of events) {
      await expectConsumed(event);
      await eventually(async () => (await state(event)).published_at, "An acknowledged event stayed pending");
      assert.equal((await state(event)).attempts, 0);
    }
  });

  await t.test("keeps events pending during a real broker outage and retries after recovery", async (ct) => {
    const event = await seed(await ticket());
    broker.pause();
    try {
      start(ct);
      await eventually(async () => (await state(event)).attempts >= 2, "Worker did not retry the unavailable broker");
      assert.equal((await state(event)).published_at, null);
    } finally {
      broker.resume();
    }
    await eventually(async () => (await state(event)).published_at, "Worker did not recover when the broker came back");
    await expectConsumed(event);
  });

  await t.test("retries a lost acknowledgement after restart even with fresh events pending", async (ct) => {
    const event = await seed(await ticket());
    const before = (await manager.streams.info(stream)).state.messages;
    const publisher = createJetStreamPublisher(config);
    const first = start(ct, {
      async publish(message) {
        await publisher.publish(message);
        throw new Error("Synthetic acknowledgement loss after broker persistence");
      },
      close: publisher.close
    });
    await eventually(async () => (await state(event)).attempts > 0, "Lost acknowledgement did not leave a retry");
    await first.stop();
    assert.equal((await state(event)).published_at, null);
    assert.equal((await manager.streams.info(stream)).state.messages, before + 1);
    const fresh = [await seed(await ticket()), await seed(await ticket())];
    const order = [];
    const restarted = createJetStreamPublisher(config);
    start(ct, {
      async publish(message) {
        order.push(message.id);
        await restarted.publish(message);
      },
      close: restarted.close
    });
    await eventually(async () => (await state(event)).published_at, "The restarted worker did not drain the backlog");
    assert.ok(fresh.some((item) => item.eventId === order[0]));
    assert.equal(order[1], event.eventId);
    await expectConsumed(event);
    await expectConsumed(fresh.find((item) => item.eventId === order[0]));
    const remaining = fresh.find((item) => item.eventId !== order[0]);
    await expectConsumed(remaining);
    await eventually(async () => (await state(remaining)).published_at, "A first attempt stayed pending");
    assert.equal((await manager.streams.info(stream)).state.messages, before + 3);
  });

  await t.test("database disconnect during publish keeps the event eligible for replay", async (ct) => {
    const event = await seed(await ticket());
    const before = (await manager.streams.info(stream)).state.messages;
    const admin = new pg.Client({ connectionString: database.adminUrl });
    await admin.connect();
    ct.after(() => admin.end());
    const acknowledged = Promise.withResolvers();
    const release = Promise.withResolvers();
    const publisher = createJetStreamPublisher(config);
    const first = start(ct, {
      async publish(message) {
        await publisher.publish(message);
        acknowledged.resolve();
        await release.promise;
      },
      close: publisher.close
    });
    try {
      await Promise.race([acknowledged.promise, delay(5000, undefined, { ref: false }).then(() => assert.fail("Broker acknowledgement did not arrive"))]);
      const { rows } = await admin.query(`SELECT pg_terminate_backend(pid, 1000) AS stopped
        FROM pg_stat_activity WHERE usename = 'tickets_runtime' AND state = 'idle in transaction'`);
      assert.deepEqual(rows, [{ stopped: true }]);
      await delay(100);
    } finally {
      void first.stop();
      release.resolve();
    }
    await first.stop();
    assert.equal((await state(event)).published_at, null);
    start(ct);
    await eventually(async () => (await state(event)).published_at, "Event did not recover after database disconnect");
    assert.equal((await manager.streams.info(stream)).state.messages, before + 1);
    await expectConsumed(event);
  });

  await t.test("workers skip locked rows and shutdown finishes the current acknowledgement", async (ct) => {
    const id = await ticket();
    const original = await seed(id);
    const following = await seed(id, 2, "claimed", { assigneeId: agent });
    const before = (await manager.streams.info(stream)).state.messages;
    const received = Promise.withResolvers();
    const release = Promise.withResolvers();
    const publisher = createJetStreamPublisher(config);
    let publications = 0;
    const first = start(ct, {
      async publish(message) {
        await publisher.publish(message);
        publications++;
        received.resolve();
        await release.promise;
      },
      close: publisher.close
    });
    let independent;
    let shutdown;
    try {
      await Promise.race([received.promise, delay(5000, undefined, { ref: false }).then(() => assert.fail("First broker acknowledgement did not arrive"))]);
      assert.equal((await state(original)).published_at, null);
      independent = await seed(await ticket());
      start(ct);
      await eventually(async () => (await state(independent)).published_at, "Second worker did not skip the locked row");
      assert.equal((await state(following)).published_at, null);
      shutdown = first.stop();
      assert.equal(first.stop(), shutdown);
      const stillDraining = await Promise.race([shutdown.then(() => false), delay(50, true)]);
      assert.ok(stillDraining);
    } finally {
      release.resolve();
    }
    await shutdown;
    assert.equal(publications, 1);
    assert.ok((await state(original)).published_at);
    await eventually(async () => (await state(following)).published_at, "Second worker did not continue the ticket");
    assert.equal((await manager.streams.info(stream)).state.messages, before + 3);
    for (const event of [original, independent, following]) await expectConsumed(event);
  });
});
