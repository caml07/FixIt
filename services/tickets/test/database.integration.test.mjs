import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import { createDatabase, cleanup } from "./fixtures/postgres17.mjs";
import { openTicketsDatabase } from "../dist/database.js";

test("migrations and isolated runtime permissions", { timeout: 120000 }, async () => {
  const fixture = await createDatabase();
  const migrate = () => execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", "prisma.config.ts"], {
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, DATABASE_URL: fixture.ownerUrl },
    encoding: "utf8", timeout: 60000
  });
  let owner;
  let runtime;
  let admin;
  try {
    migrate();
    assert.match(migrate(), /No pending migrations/i);
    owner = new pg.Client({ connectionString: fixture.ownerUrl });
    await owner.connect();
    const history = await owner.query('SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name');
    assert.deepEqual(history.rows.map((row) => row.migration_name), ["20261115000100_initial", "20261126000100_ticket_intake_and_evidence"]);
    await owner.query("GRANT USAGE ON SCHEMA tickets TO tickets_runtime");
    await owner.query("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tickets TO tickets_runtime");
    const reporter = await owner.query("INSERT INTO auth.users (email, display_name, role, account_status, password_hash) VALUES ('reporter@example.test', 'Synthetic', 'REPORTER', 'ACTIVE', 'synthetic') RETURNING id");
    runtime = openTicketsDatabase(fixture.runtimeUrl);
    for (const table of ["categories", "support_tickets", "ticket_timeline", "outbox", "ticket_attachments"]) {
      await runtime.query(`SELECT * FROM tickets.${table} LIMIT 0`);
    }
    assert.equal((await runtime.query("SELECT count(*)::int AS count FROM tickets.categories")).rows[0].count, 5);
    const result = await runtime.query("INSERT INTO tickets.support_tickets (reporter_id, category_code, title, description, reporter_urgency) VALUES ($1, 'HARDWARE', 'Synthetic', 'Synthetic', 'NORMAL') RETURNING id", [reporter.rows[0].id]);
    assert.ok(result.rows[0].id);
    for (const table of ["users", "sessions", "account_audit"]) {
      await assert.rejects(runtime.query(`SELECT * FROM auth.${table} LIMIT 1`), { code: "42501" });
    }
    admin = new pg.Client({ connectionString: fixture.adminUrl });
    await admin.connect();
    const { rows: [{ pid }] } = await runtime.query("SELECT pg_backend_pid() AS pid");
    const removed = new Promise((resolve) => runtime.once("remove", resolve));
    assert.equal((await admin.query("SELECT pg_terminate_backend($1, 1000) AS stopped", [pid])).rows[0].stopped, true);
    await Promise.race([removed, delay(4000, undefined, { ref: false }).then(() => assert.fail("Pool retained the terminated client"))]);
    assert.notEqual((await runtime.query("SELECT pg_backend_pid() AS pid")).rows[0].pid, pid);
    await assert.rejects(runtime.query("SELECT pg_sleep(10)"), { code: "57014" });
    assert.equal((await runtime.query("SELECT 1 AS ready")).rows[0].ready, 1);
  } finally {
    await runtime?.end();
    await owner?.end();
    await admin?.end();
    await cleanup();
  }
});

test("fixture cleans up after a controlled failure", { timeout: 60000 }, async () => {
  const fixture = await createDatabase();
  try {
    assert.throws(() => { throw new Error("controlled failure"); }, /controlled failure/);
  } finally {
    await cleanup();
  }
  const host = process.platform === "win32" ? "npipe:////./pipe/dockerDesktopLinuxEngine" : "unix:///var/run/docker.sock";
  const env = { ...process.env };
  delete env.DOCKER_CONTEXT;
  delete env.DOCKER_HOST;
  assert.throws(() => execFileSync(process.env.CONTAINER_ENGINE || "docker", ["--host", host, "inspect", fixture.containerId], { stdio: "ignore", timeout: 10000, env }));
});

test("a startup timeout finds only the named and labelled test container", async () => {
  const calls = [];
  let scans = 0;
  function fakeDocker(args) {
    calls.push(args);
    if (args[0] === "create") return "owned-container";
    if (args[0] === "start") throw new Error("simulated startup timeout");
    if (args[0] === "ps") return scans++ === 0 ? "owned-container" : "";
    return "";
  }
  await assert.rejects(createDatabase(fakeDocker), /simulated startup timeout/);
  const scan = calls.find((args) => args[0] === "ps");
  const label = scan.find((arg) => arg.startsWith("label=fixit.tickets.test="));
  const name = label.slice("label=fixit.tickets.test=".length);
  assert.ok(scan.includes("name=^/" + name + "$"));
  assert.deepEqual(calls.filter((args) => args[0] === "rm"), [["rm", "-f", "owned-container"]]);
  await cleanup(fakeDocker);
  assert.equal(calls.filter((args) => args[0] === "rm").length, 1);
});

test("a create timeout recovers a container without a returned ID", async () => {
  const calls = [];
  let scans = 0;
  function fakeDocker(args) {
    calls.push(args);
    if (args[0] === "create") throw new Error("simulated create timeout");
    if (args[0] === "ps") return scans++ === 0 ? "owned-container" : "";
    return "";
  }
  await assert.rejects(createDatabase(fakeDocker), /simulated create timeout/);
  assert.deepEqual(calls.filter((args) => args[0] === "rm"), [["rm", "-f", "owned-container"]]);
});
