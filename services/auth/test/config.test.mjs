import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readAuthConfig, readPasswordBlocklist } from "../src/config.ts";
import { passwordError } from "../src/security.ts";

test("Auth accepts only the exact HTTPS origin used by browsers", () => {
  const original = { ...process.env };
  Object.assign(process.env, {
    AUTH_DATABASE_URL: "postgresql://localhost/fixit",
    AUTH_CSRF_KEY: randomUUID(),
    AUTH_TICKETS_SERVICE_TOKEN: randomUUID(),
    AUTH_CHAT_SERVICE_TOKEN: randomUUID(),
    AUTH_PUBLIC_ORIGIN: "https://fixit.example.invalid:8443",
  });
  try {
    assert.equal(readAuthConfig().AUTH_PUBLIC_ORIGIN, "https://fixit.example.invalid:8443");
    for (const origin of ["http://fixit.example.invalid", "https://fixit.example.invalid/",
      "https://fixit.example.invalid/path", "https://fixit.example.invalid?x=1",
      "https://user@fixit.example.invalid", "null"]) {
      process.env.AUTH_PUBLIC_ORIGIN = origin;
      assert.throws(() => readAuthConfig(), undefined, origin);
    }
  } finally {
    for (const key of ["AUTH_DATABASE_URL", "AUTH_CSRF_KEY", "AUTH_TICKETS_SERVICE_TOKEN",
      "AUTH_CHAT_SERVICE_TOKEN", "AUTH_PUBLIC_ORIGIN"]) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test("rate limits default safely and reject values above the approved maximum", () => {
  const values = {
    AUTH_DATABASE_URL: "postgresql://localhost/fixit", AUTH_CSRF_KEY: randomUUID(),
    AUTH_TICKETS_SERVICE_TOKEN: randomUUID(), AUTH_CHAT_SERVICE_TOKEN: randomUUID(),
    AUTH_PUBLIC_ORIGIN: "https://fixit.example.invalid",
  };
  const keys = [...Object.keys(values), "AUTH_LOGIN_RATE_LIMIT", "AUTH_ADMIN_RATE_LIMIT", "AUTH_ACTIVATION_RATE_LIMIT"];
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  for (const key of keys.slice(-3)) delete process.env[key];
  try {
    const defaults = readAuthConfig();
    assert.equal(defaults.AUTH_LOGIN_RATE_LIMIT, 20);
    assert.equal(defaults.AUTH_ADMIN_RATE_LIMIT, 60);
    assert.equal(defaults.AUTH_ACTIVATION_RATE_LIMIT, 20);
    Object.assign(process.env, { AUTH_LOGIN_RATE_LIMIT: "2", AUTH_ADMIN_RATE_LIMIT: "3", AUTH_ACTIVATION_RATE_LIMIT: "4" });
    const stricter = readAuthConfig();
    assert.equal(stricter.AUTH_LOGIN_RATE_LIMIT, 2);
    assert.equal(stricter.AUTH_ADMIN_RATE_LIMIT, 3);
    assert.equal(stricter.AUTH_ACTIVATION_RATE_LIMIT, 4);
    for (const bad of ["0", "-1", "21", "2.5", "abc"]) {
      process.env.AUTH_LOGIN_RATE_LIMIT = bad;
      assert.throws(() => readAuthConfig(), undefined, bad);
    }
  } finally {
    for (const key of keys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
});

test("production password blocklist fails closed and preserves complete Unicode entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fixit-blocklist-"));
  const path = join(directory, "list.txt");
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(() => readPasswordBlocklist(undefined));
    assert.throws(() => readPasswordBlocklist(path));
    await writeFile(path, " \n\t\n");
    assert.throws(() => readPasswordBlocklist(path));
    await writeFile(path, "short\nless-than-15\n");
    assert.throws(() => readPasswordBlocklist(path));
    await writeFile(path, Buffer.from([0xff, 0xfe]));
    assert.throws(() => readPasswordBlocklist(path));
    await writeFile(path, "\ufeffFrase vulnerable con espacio \r\ncontrasen\u0303a vulnerable\n");
    const blocklist = readPasswordBlocklist(path);
    assert.notEqual(passwordError("frase vulnerable con espacio ", blocklist), null);
    assert.equal(passwordError("frase vulnerable con espacio", blocklist), null);
    assert.notEqual(passwordError("contrase\u00f1a vulnerable", blocklist), null);
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
    await rm(directory, { recursive: true, force: true });
  }
});
