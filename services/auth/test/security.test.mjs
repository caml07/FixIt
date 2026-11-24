import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanPassword,
  newSecret,
  passwordError,
  readSessionCookie,
  setSessionCookie,
  tokenHash,
} from "../src/security.ts";

test("personal passwords follow the minimum length and Unicode rules", () => {
  assert.notEqual(passwordError("abcdefghijklmn"), null);
  assert.equal(passwordError("abcdefghijklmnop"), null);
  assert.equal(passwordError("frase segura con espacios"), null);
  assert.equal(passwordError("ñ".repeat(64)), null);
  assert.equal(cleanPassword("n\u0303"), "ñ");
  assert.notEqual(passwordError("passwordpassword"), null);
});

test("session cookies contain an opaque secret and security attributes", () => {
  const secret = newSecret();
  const cookie = setSessionCookie(secret, 60);
  assert.match(cookie, /^__Host-fixit_session=[A-Za-z0-9_-]{43};/);
  assert.match(cookie, /; Path=\/; Max-Age=60; HttpOnly; Secure; SameSite=Strict$/);
  assert.equal(readSessionCookie(cookie.split(";")[0]), secret);
  assert.notEqual(tokenHash(secret), secret);
});

test("missing, malformed or duplicate session cookies are rejected", () => {
  const secret = newSecret();
  assert.equal(readSessionCookie(undefined), undefined);
  assert.equal(readSessionCookie("__Host-fixit_session=invalid"), undefined);
  assert.equal(readSessionCookie(`__Host-fixit_session=${secret}; __Host-fixit_session=${secret}`), undefined);
});
