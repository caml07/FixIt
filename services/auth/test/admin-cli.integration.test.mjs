import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { openAuthDatabase } from "../src/db.ts";

test("bootstrap refuses redirected output before creating an Admin", async () => {
  const dbUrl = process.env.FIXIT_TEST_DB_URL;
  assert.ok(dbUrl, "FIXIT_TEST_DB_URL must point to a disposable PostgreSQL test database.");
  const email = `bootstrap.${randomUUID()}@invalid.example`;
  const db = openAuthDatabase(dbUrl);
  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", "services/auth/src/admin-cli.ts", "bootstrap", email], {
      env: { ...process.env, AUTH_DATABASE_URL: dbUrl }, encoding: "utf8", timeout: 15000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /private interactive TTY/);
    assert.doesNotMatch(result.stdout, /Temporary password/);
    assert.equal(await db.user.count({ where: { email } }), 0);
  } finally {
    await db.$disconnect();
  }
});
