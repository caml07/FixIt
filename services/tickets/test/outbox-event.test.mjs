import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { outboxMessage } from "../dist/outbox-event.js";
import { loadOutboxConfig } from "../dist/config.js";

test("outbox is opt-in and rejects ambiguous or unsafe broker configuration", () => {
  assert.equal(loadOutboxConfig({}), undefined);
  const env = { TICKETS_DATABASE_URL: "local-test-fixture" };
  for (const endpoint of ["", "nats://example.test:4222", "nats://127.0.0.1:0", "tls://me:private@example.test",
    "tls://example.test/path", "tls://example.test?token=private", "tls://example.test,", "http://127.0.0.1"]) {
    assert.throws(() => loadOutboxConfig({ ...env, TICKETS_NATS_URL: endpoint }), /Invalid TICKETS_NATS_URL/);
  }
  assert.throws(() => loadOutboxConfig({ TICKETS_NATS_URL: "nats://127.0.0.1:4222" }), /TICKETS_DATABASE_URL is required/);
  assert.throws(() => loadOutboxConfig({ ...env, TICKETS_NATS_TOKEN: randomUUID() }), /Invalid TICKETS_NATS_URL/);
  assert.equal(loadOutboxConfig({ ...env, TICKETS_NATS_URL: "nats://127.0.0.1:4222" }).tls, false);
  assert.equal(loadOutboxConfig({ ...env, TICKETS_NATS_URL: "tls://example.test:4222" }).tls, true);
});

test("only the contracted outbox envelope and payload can reach JetStream", () => {
  const id = randomUUID();
  const ticketId = randomUUID();
  const assigneeId = randomUUID();
  const reporterId = randomUUID();
  const cases = [
    ["created", { reporterId }],
    ["claimed", { assigneeId }],
    ["status-changed", { from: "OPEN", to: "CANCELLED" }],
    ["reassigned", { previousAssigneeId: randomUUID(), assigneeId }]
  ];
  for (const [kind, fields] of cases) {
    const type = `ticket.${kind}.v1`;
    const version = kind === "created" ? 1 : 3;
    const event = { eventId: id, type, schemaVersion: 1, aggregateId: ticketId, aggregateVersion: version,
      occurredAt: new Date().toISOString(), correlationId: randomUUID(), payload: { ticketId, ...fields } };
    const row = { id, ticket_id: ticketId, aggregate_version: version, event_type: type, payload: event };
    const message = outboxMessage(row);
    assert.deepEqual(message, { id, subject: `fixit.${type}`, body: JSON.stringify(event) });
    assert.equal(outboxMessage({ ...row, id: randomUUID() }), undefined);
    assert.equal(outboxMessage({ ...row, payload: { ...event, email: "synthetic@example.test" } }), undefined);
    assert.equal(outboxMessage({ ...row, payload: { ...event, payload: { ...event.payload, description: "private" } } }), undefined);
  }
});
