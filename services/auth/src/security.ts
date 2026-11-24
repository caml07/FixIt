import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "__Host-fixit_session";
export const TEMPORARY_SECONDS = 15 * 60;
export const FULL_SECONDS = 8 * 60 * 60;
export const TEMPORARY_PASSWORD_HOURS = 72;

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function equalsSecret(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function csrfToken(tokenDigest: string, csrfKey: string): string {
  return createHmac("sha256", csrfKey).update(tokenDigest).digest("base64url");
}

export function readSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const matches = header.split(";").map((entry) => entry.trim()).filter((entry) =>
    entry.startsWith(SESSION_COOKIE + "="));
  if (matches.length !== 1) return undefined;
  const raw = matches[0].slice(SESSION_COOKIE.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : undefined;
}

export function setSessionCookie(token: string, seconds: number): string {
  return SESSION_COOKIE + "=" + token + "; Path=/; Max-Age=" + seconds +
    "; HttpOnly; Secure; SameSite=Strict";
}

export function clearSessionCookie(): string {
  return SESSION_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict";
}

export function cleanPassword(password: string): string {
  return password.normalize("NFC");
}

const COMMON_PASSWORDS = new Set([
  "password123456789", "123456789012345", "qwertyuiop123456",
  "passwordpassword", "adminadminadmin123",
]);

export function passwordError(password: string): string | null {
  const normalized = cleanPassword(password);
  const length = Array.from(normalized).length;
  if (length < 15) return "La contraseña necesita al menos 15 caracteres.";
  if (Buffer.byteLength(normalized, "utf8") > 1024) return "Contraseña demasiado larga.";
  if (COMMON_PASSWORDS.has(normalized.toLowerCase())) return "Contraseña demasiado conocida.";
  return null;
}

export function expiresAtHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}
