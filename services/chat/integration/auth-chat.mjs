import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { io } from "socket.io-client";
import { reporterId, startFixtures, ticketId } from "../local/fixtures.ts";
import { startChat } from "../src/server.ts";

const authRoot = process.env.FIXIT_AUTH_ROOT;
if (
  !authRoot ||
  !process.env.FIXIT_TEST_DB_URL ||
  !process.env.FIXIT_TEST_MONGO_URL
)
  throw new Error(
    "Run via scripts/test-real-auth.sh with FIXIT_AUTH_ROOT set.",
  );
const requireAuth = createRequire(resolve(authRoot, "package.json"));
const argon2 = requireAuth("argon2");
const { createAuthApp } = await import(
  pathToFileURL(resolve(authRoot, "services/auth/src/app.ts")).href
);
const { openAuthDatabase } = await import(
  pathToFileURL(resolve(authRoot, "services/auth/src/db.ts")).href
);
const origin = "https://fixit.example.invalid";
const chatToken = randomBytes(32).toString("base64url");
const ticketToken = randomBytes(32).toString("base64url");
const db = openAuthDatabase(process.env.FIXIT_TEST_DB_URL);
let auth, fixtures, chat, socket;
try {
  await db.$connect();
  const password = randomBytes(32).toString("base64url");
  const hash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await db.user.create({
    data: {
      id: reporterId,
      email: "integration@invalid.example",
      displayName: "Reporter Test",
      role: "REPORTER",
      accountStatus: "ACTIVE",
      passwordHash: hash,
    },
  });
  auth = createServer(
    createAuthApp({
      database: db,
      publicOrigin: origin,
      csrfKey: "synthetic-csrf-key-for-isolated-test-123456",
      serviceTokens: [ticketToken, chatToken],
    }),
  );
  await new Promise((resolve) => auth.listen(0, "127.0.0.1", resolve));
  const authUrl = `http://127.0.0.1:${auth.address().port}`;
  fixtures = await startFixtures({ serviceToken: chatToken });
  chat = await startChat({
    mongoUri: process.env.FIXIT_TEST_MONGO_URL,
    authUrl,
    ticketsUrl: fixtures.url,
    serviceToken: chatToken,
    origin,
    port: 0,
  });
  const login = await fetch(`${authUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "integration@invalid.example", password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const token = cookie.slice(cookie.indexOf("=") + 1);
  fixtures.sessions.set(token, {
    userId: reporterId,
    role: "REPORTER",
    active: true,
  });
  socket = io(chat.url, {
    transports: ["websocket"],
    extraHeaders: { Origin: origin, Cookie: cookie },
    reconnection: false,
    timeout: 3000,
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const joined = await socket
    .timeout(5000)
    .emitWithAck("ticket:join", { ticketId });
  assert.equal(joined.ok, true);
  const message = await socket.timeout(5000).emitWithAck("chat:send", {
    ticketId,
    clientMessageId: randomUUID(),
    body: "Synthetic integration message",
  });
  assert.equal(message.ok, true);
  const history = await fetch(
    `${chat.url}/api/v1/tickets/${ticketId}/messages`,
    { headers: { Cookie: cookie } },
  );
  assert.equal(history.status, 200);
  const payload = await history.json();
  assert.equal(payload.data.items[0].id, message.data.messageId);
  const csrfResponse = await fetch(`${authUrl}/api/v1/auth/csrf`, {
    headers: { Cookie: cookie },
  });
  const csrf = (await csrfResponse.json()).data.csrfToken;
  const logout = await fetch(`${authUrl}/api/v1/auth/logout`, {
    method: "POST",
    headers: { Origin: origin, Cookie: cookie, "X-CSRF-Token": csrf },
  });
  assert.equal(logout.status, 204);
  const revoked = await fetch(
    `${chat.url}/api/v1/tickets/${ticketId}/messages`,
    { headers: { Cookie: cookie } },
  );
  assert.equal(revoked.status, 401);
  const after = await socket.timeout(5000).emitWithAck("chat:send", {
    ticketId,
    clientMessageId: randomUUID(),
    body: "Must be denied",
  });
  assert.equal(after.ok, false);
  assert.equal(after.error.code, "UNAUTHORIZED");
  console.log(
    "PASS: real Auth + real Chat + PostgreSQL + MongoDB; login, join, send, history, logout and revocation; Tickets is a fixture.",
  );
} finally {
  if (socket) socket.disconnect();
  if (chat) await chat.close();
  if (fixtures) await fixtures.close();
  if (auth) await new Promise((resolve) => auth.close(resolve));
  await db.$disconnect();
}
