import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as createTcpServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const authRoot = process.env.FIXIT_AUTH_ROOT;
const dbUrl = process.env.FIXIT_TEST_DB_URL;
if (!authRoot || !dbUrl) throw new Error("Run through scripts/test-real-auth.sh.");
const requireAuth = createRequire(resolve(authRoot, "package.json"));
const argon2 = requireAuth("argon2");
const { createAuthApp } = await import(
  pathToFileURL(resolve(authRoot, "services/auth/src/app.ts")).href
);
const { openAuthDatabase } = await import(
  pathToFileURL(resolve(authRoot, "services/auth/src/db.ts")).href
);
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://fixit.example.invalid";
const db = openAuthDatabase(dbUrl);
let auth;
let vite;
let browser;
try {
  await db.$connect();
  const temporary = randomBytes(32).toString("base64url");
  const personal = randomBytes(32).toString("base64url");
  const passwordHash = await argon2.hash(temporary, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  await db.user.create({
    data: {
      email: "browser@invalid.example",
      displayName: "Browser Test",
      role: "REPORTER",
      accountStatus: "PENDING_PASSWORD_CHANGE",
      temporaryExpiresAt: new Date(Date.now() + 3600000),
      passwordHash,
    },
  });
  auth = createHttpServer(
    createAuthApp({
      database: db,
      publicOrigin: origin,
      csrfKey: "synthetic-browser-csrf-key-for-test-only",
      serviceTokens: [
        "synthetic-tickets-service-token-for-test",
        "synthetic-chat-service-token-for-test",
      ],
    }),
  );
  await new Promise((resolveListen) => auth.listen(0, "127.0.0.1", resolveListen));
  const port = await new Promise((resolvePort, reject) => {
    const server = createTcpServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        resolvePort(address && typeof address !== "string" ? address.port : 0),
      );
    });
  });
  assert.ok(port);
  vite = spawn(
    process.execPath,
    [
      resolve(webRoot, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        VITE_AUTH_MODE: "real",
        FIXIT_AUTH_TARGET: `http://127.0.0.1:${auth.address().port}`,
        FIXIT_PUBLIC_ORIGIN: origin,
      },
      stdio: "ignore",
    },
  );
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "Vite did not start");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.FIXIT_CHROMIUM_PATH
      ? { executablePath: process.env.FIXIT_CHROMIUM_PATH }
      : {}),
  });
  const page = await browser.newPage();
  await page.route("**/__dev/tickets", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { items: [] } }),
    }),
  );
  await page.goto(url);
  await page.getByLabel("Work email").fill("browser@invalid.example");
  await page.getByLabel("Password", { exact: true }).fill(temporary);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Choose a new password" }).waitFor();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await page.getByLabel("Work email").fill("browser@invalid.example");
  await page.getByLabel("Password", { exact: true }).fill(temporary);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Choose a new password" }).waitFor();
  await page.getByLabel("Temporary password").fill(temporary);
  await page.getByLabel("New password").fill(personal);
  await page.getByRole("button", { name: "Update password" }).click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await page.getByLabel("Work email").fill("browser@invalid.example");
  await page.getByLabel("Password", { exact: true }).fill(personal);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: /Browser Test/ }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  console.log(
    "PASS: browser + real Auth: temporary login, activation, personal login and logout; Tickets simulated.",
  );
} finally {
  if (browser) await browser.close();
  if (vite) vite.kill();
  if (auth) await new Promise((resolveClose) => auth.close(resolveClose));
  await db.$disconnect();
}
