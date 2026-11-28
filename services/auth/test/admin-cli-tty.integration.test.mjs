import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import argon2 from "argon2";
import { openAuthDatabase } from "../src/db.ts";
import { newSecret, tokenHash } from "../src/security.ts";

test("private CLI bootstraps once and recovers the same Admin while revoking sessions", {
  skip: process.env.FIXIT_AUTH_TTY_TEST !== "1",
  timeout: 45000,
}, async () => {
  const dbUrl = process.env.FIXIT_TEST_DB_URL;
  const winpty = process.env.FIXIT_WINPTY_PATH;
  assert.ok(dbUrl && winpty, "an isolated PostgreSQL URL and winpty are required");
  assert.ok(process.stdin.isTTY, "this test needs an interactive terminal");
  const db = openAuthDatabase(dbUrl);
  const email = `bootstrap.${randomUUID()}@invalid.example`;
  function cli(command, value) {
    const args = ["-Xallow-non-tty", "--", process.execPath, "--import", "tsx",
      "services/auth/src/admin-cli.ts", command];
    if (value) args.push(value);
    const result = spawnSync(winpty, args, {
      stdio: ["inherit", "pipe", "pipe"], encoding: "utf8", timeout: 15000,
      env: { ...process.env, AUTH_DATABASE_URL: dbUrl },
    });
    const output = result.stdout.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/[\r\n]/g, "");
    const matches = [...output.matchAll(/Temporary password \(shown once, expires in 72h\):\s*([A-Za-z0-9_-]{43})/g)];
    return { status: result.status, passwords: matches.map((match) => match[1]) };
  }
  try {
    const start = Date.now();
    const first = cli("bootstrap", email);
    assert.equal(first.status, 0);
    assert.equal(first.passwords.length, 1);
    const admin = await db.user.findFirstOrThrow({ where: { email } });
    assert.equal(admin.role, "ADMIN");
    assert.equal(admin.accountStatus, "PENDING_PASSWORD_CHANGE");
    assert.ok(admin.temporaryExpiresAt.getTime() >= start + 72 * 3600000);
    assert.ok(admin.temporaryExpiresAt.getTime() <= Date.now() + 72 * 3600000);
    assert.ok(await argon2.verify(admin.passwordHash, first.passwords[0]));
    const repeated = cli("bootstrap", email);
    assert.equal(repeated.status, 1);
    assert.equal(repeated.passwords.length, 0);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash, admin.passwordHash);
    const session = await db.session.create({ data: { userId: admin.id, tokenHash: tokenHash(newSecret()),
      scope: "PASSWORD_CHANGE_ONLY", expiresAt: new Date(Date.now() + 60000) } });
    const recoveryStart = Date.now();
    const recovered = cli("reset-admin");
    assert.equal(recovered.status, 0);
    assert.equal(recovered.passwords.length, 1);
    const updated = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    assert.equal(updated.email, email);
    assert.equal(updated.accountStatus, "PENDING_PASSWORD_CHANGE");
    assert.ok(updated.temporaryExpiresAt.getTime() >= recoveryStart + 72 * 3600000);
    assert.ok(updated.temporaryExpiresAt.getTime() <= Date.now() + 72 * 3600000);
    assert.notEqual(updated.passwordHash, admin.passwordHash);
    assert.ok(await argon2.verify(updated.passwordHash, recovered.passwords[0]));
    assert.equal(await argon2.verify(updated.passwordHash, first.passwords[0]), false);
    assert.ok((await db.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt);
    const actions = (await db.accountAudit.findMany({ where: { subjectUserId: admin.id } })).map((event) => event.action);
    assert.deepEqual(actions.sort(), ["BOOTSTRAPPED", "PASSWORD_RESET"]);
    assert.equal(await db.user.count({ where: { role: "ADMIN" } }), 1);
  } finally {
    await db.$disconnect();
  }
});
