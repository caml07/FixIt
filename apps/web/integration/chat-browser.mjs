import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const chatRoot = process.env.FIXIT_CHAT_ROOT;
const mongoUri = process.env.FIXIT_TEST_MONGO_URL;
if (!chatRoot || !mongoUri) throw new Error("Run through scripts/test-real-chat.sh.");
const { startFixtures } = await import(
  pathToFileURL(resolve(chatRoot, "local/fixtures.ts")).href
);
const { startChat } = await import(
  pathToFileURL(resolve(chatRoot, "src/server.ts")).href
);
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let fixtures;
let chat;
let vite;
let browser;
try {
  const port = await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        resolvePort(address && typeof address !== "string" ? address.port : 0),
      );
    });
  });
  assert.ok(port);
  const url = `http://127.0.0.1:${port}`;
  fixtures = await startFixtures();
  chat = await startChat({
    mongoUri,
    authUrl: fixtures.url,
    ticketsUrl: fixtures.url,
    serviceToken: fixtures.serviceToken,
    origin: url,
    port: 0,
  });
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
        VITE_AUTH_MODE: "preview",
        FIXIT_CHAT_TARGET: chat.url,
        FIXIT_FIXTURES_TARGET: fixtures.url,
        FIXIT_PUBLIC_ORIGIN: url,
      },
      stdio: "ignore",
    },
  );
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
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole("button", { name: "Support agent" }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("tab", { name: /Assigned to me/ }).click();
  await page.getByRole("link", { name: /Printer keeps dropping/ }).click();
  await page.getByText("Live", { exact: true }).waitFor();
  const message = `Synthetic message ${Date.now()}`;
  await page.getByRole("textbox", { name: "Write a message" }).fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
  await page.locator(".message-bubble").filter({ hasText: message }).first().waitFor();
  await page.reload();
  await page.locator(".message-bubble").filter({ hasText: message }).first().waitFor();
  await context.setOffline(true);
  await page.getByText("Reconnecting", { exact: true }).waitFor({ timeout: 10000 });
  await context.setOffline(false);
  await page.getByText("Live", { exact: true }).waitFor({ timeout: 20000 });
  await page.locator(".message-bubble").filter({ hasText: message }).first().waitFor();
  console.log(
    "PASS: browser + real Chat + Mongo: send, reload, offline and reconnect; Auth and Tickets simulated.",
  );
} finally {
  if (browser) await browser.close();
  if (vite) vite.kill();
  if (chat) await chat.close();
  if (fixtures) await fixtures.close();
}
