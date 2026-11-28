import "dotenv/config";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { cleanPassword, FULL_SECONDS, IDLE_SECONDS, TEMPORARY_SECONDS } from "./security.ts";

const schema = z.object({
  AUTH_DATABASE_URL: z.string().min(1),
  AUTH_PUBLIC_ORIGIN: z.url().refine((value) => {
    if (!URL.canParse(value)) return false;
    const origin = new URL(value);
    return origin.protocol === "https:" && origin.origin === value;
  }),
  AUTH_CSRF_KEY: z.string().min(32),
  AUTH_TICKETS_SERVICE_TOKEN: z.string().min(32),
  AUTH_CHAT_SERVICE_TOKEN: z.string().min(32),
  AUTH_LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).max(20).default(20),
  AUTH_ADMIN_RATE_LIMIT: z.coerce.number().int().min(1).max(60).default(60),
  AUTH_ACTIVATION_RATE_LIMIT: z.coerce.number().int().min(1).max(20).default(20),
  AUTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  AUTH_FULL_SESSION_SECONDS: z.coerce.number().int().min(1).max(86400).default(FULL_SECONDS),
  AUTH_IDLE_SESSION_SECONDS: z.coerce.number().int().min(1).max(86400).default(IDLE_SECONDS),
  AUTH_TEMPORARY_SESSION_SECONDS: z.coerce.number().int().min(1).max(3600).default(TEMPORARY_SECONDS),
  AUTH_PASSWORD_BLOCKLIST_FILE: z.string().min(1).optional(),
});

export function readAuthConfig() {
  const result = schema.safeParse(process.env);
  if (!result.success) throw new Error("Auth configuration missing or invalid.");
  const config = result.data;
  if (config.AUTH_TICKETS_SERVICE_TOKEN === config.AUTH_CHAT_SERVICE_TOKEN) {
    throw new Error("Distinct internal service credentials are required.");
  }
  return config;
}

export function readPasswordBlocklist(path: string | undefined): ReadonlySet<string> {
  if (!path) {
    if (process.env.NODE_ENV === "production") throw new Error("AUTH_PASSWORD_BLOCKLIST_FILE required in production.");
    return new Set();
  }
  const contents = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path));
  const entries = new Set(contents.split(/\r?\n/).filter(Boolean).map((entry) => cleanPassword(entry).toLowerCase()));
  let hasUsableEntry = false;
  for (const entry of entries) {
    if (entry.trim().length > 0 && Array.from(entry).length >= 15 && Buffer.byteLength(entry, "utf8") <= 1024) {
      hasUsableEntry = true;
      break;
    }
  }
  if (!hasUsableEntry) throw new Error("Password blocklist is empty.");
  return entries;
}
