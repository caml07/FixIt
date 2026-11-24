import "dotenv/config";
import { createAuthApp } from "./app.ts";
import { readAuthConfig, readPasswordBlocklist } from "./config.ts";
import { openAuthDatabase } from "./db.ts";

const config = readAuthConfig();
const passwordBlocklist = readPasswordBlocklist(config.AUTH_PASSWORD_BLOCKLIST_FILE);
const db = openAuthDatabase(config.AUTH_DATABASE_URL);
await db.$connect();

const app = createAuthApp({
  database: db,
  publicOrigin: config.AUTH_PUBLIC_ORIGIN,
  csrfKey: config.AUTH_CSRF_KEY,
  serviceTokens: [config.AUTH_TICKETS_SERVICE_TOKEN, config.AUTH_CHAT_SERVICE_TOKEN],
  passwordBlocklist,
  sessionTimeouts: { full: config.AUTH_FULL_SESSION_SECONDS, idle: config.AUTH_IDLE_SESSION_SECONDS, temporary: config.AUTH_TEMPORARY_SESSION_SECONDS },
});

const host = process.env.AUTH_BIND_HOST ?? "127.0.0.1";
const server = app.listen(config.AUTH_PORT, host, () => {
  console.info("FixIt Auth listening on configured host and port.");
});

async function shutdown() {
  server.close();
  await db.$disconnect();
}
process.once("SIGINT", () => { void shutdown(); });
process.once("SIGTERM", () => { void shutdown(); });
