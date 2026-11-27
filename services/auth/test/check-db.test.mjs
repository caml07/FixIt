import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { test } from "node:test";

function checkDb(url) {
  return spawnSync(process.execPath, ["--import", "tsx", "services/auth/src/check-db.ts"], {
    encoding: "utf8",
    env: { ...process.env, AUTH_DATABASE_URL: url },
    timeout: 10000,
  });
}

test("Auth database check accepts its restricted PostgreSQL role", () => {
  assert.ok(process.env.FIXIT_TEST_DB_URL, "a disposable database is required");
  const result = checkDb(process.env.FIXIT_TEST_DB_URL);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Auth database check: available/);
});

test("Auth database check fails safely when PostgreSQL is unavailable", () => {
  const result = checkDb("postgresql://test:synthetic@127.0.0.1:1/test");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Auth database check: unavailable/);
  assert.doesNotMatch(result.stderr, /synthetic|postgresql:/);
});

test("Auth database check rejects invalid credentials without exposing them", () => {
  assert.ok(process.env.FIXIT_TEST_DB_URL, "a disposable database is required");
  const invalid = new URL(process.env.FIXIT_TEST_DB_URL);
  invalid.password = "wrong-synthetic-password";
  const result = checkDb(invalid.href);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Auth database check: unavailable/);
  assert.doesNotMatch(result.stderr, /wrong-synthetic-password|postgresql:/);
});

test("Auth database check rejects missing configuration", () => {
  const result = checkDb("");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /configuration missing/);
});

test("Auth database check handles a malformed URL without exposing it", () => {
  const result = checkDb("postgresql://sample:synthetic-secret@[invalid");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Auth database check: unavailable/);
  assert.doesNotMatch(result.stderr, /synthetic-secret|postgresql:|\bat /);
});

test("Auth database check does not hang when a server stops responding", async (t) => {
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const child = spawn(process.execPath, ["--import", "tsx", "services/auth/src/check-db.ts"], {
    env: { ...process.env, AUTH_DATABASE_URL: `postgresql://test@127.0.0.1:${address.port}/test` },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 10000);
  const [code, signal] = await new Promise((resolve) => child.on("close", (c, s) => resolve([c, s])));
  clearTimeout(timer);
  assert.equal(signal, null, "the check must exit without being killed");
  assert.equal(code, 1);
  assert.match(stderr, /Auth database check: unavailable/);
});
