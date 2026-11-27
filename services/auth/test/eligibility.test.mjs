import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createAuthApp } from "../src/app.ts";

test("eligibility limits access to Tickets and fails closed on database errors", async () => {
  const agentId = randomUUID();
  const ticketsToken = randomUUID();
  const chatToken = randomUUID();
  let unavailable = false;
  const database = { user: { findUnique: async ({ where }) => {
    if (unavailable) throw new Error("synthetic database failure");
    return where.id === agentId ? { role: "SUPPORT_AGENT", accountStatus: "ACTIVE" } : null;
  } } };
  const server = createServer(createAuthApp({ database, publicOrigin: "https://fixit.example.invalid",
    csrfKey: "synthetic-csrf-key-for-tests-0000000000", serviceTokens: [ticketsToken, chatToken] }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/internal/v1/users`;
  async function get(id, token) {
    return fetch(`${base}/${id}/agent-eligibility`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  }
  try {
    assert.equal((await get(agentId)).status, 401);
    assert.equal((await get(agentId, "invalid")).status, 401);
    assert.equal((await get(agentId, chatToken)).status, 403);
    const response = await get(agentId, ticketsToken);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual((await response.json()).data, { eligible: true });
    assert.deepEqual((await (await get(randomUUID(), ticketsToken)).json()).data, { eligible: false });
    assert.deepEqual((await (await get("invalid-id", ticketsToken)).json()).data, { eligible: false });
    unavailable = true;
    assert.equal((await get(agentId, ticketsToken)).status, 503);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
