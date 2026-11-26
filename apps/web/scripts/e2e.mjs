import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.FIXIT_URL ?? "http://localhost:5173";
const evidence = new URL("../../../.impeccable/review/", import.meta.url);
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.FIXIT_CHROMIUM_PATH,
});
const errors = [];
const shot = async (page, name) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: new URL(name, evidence).pathname,
    animations: "disabled",
  });
};
const login = async (page, role) => {
  await page.goto(base);
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await page.getByRole("button", { name: role }).click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
};
try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await desktop.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.getByRole("heading", { name: "Welcome back" }).waitFor();
  await shot(page, "login-desktop.png");
  await login(page, "Support agent");
  await page.getByRole("heading", { name: "Support inbox" }).waitFor();
  await page
    .getByRole("link", { name: /Cannot access the shared course drive/ })
    .waitFor();
  await shot(page, "desktop.png");
  await page.getByRole("tab", { name: /Assigned to me/ }).click();
  await shot(page, "assigned-desktop.png");
  await page.getByRole("link", { name: /Printer keeps dropping/ }).click();
  await page.getByText("Live", { exact: true }).waitFor({ timeout: 15000 });
  const message = `I am checking the printer connection now. [${Date.now()}]`;
  await page.getByRole("textbox", { name: "Write a message" }).fill(message);
  await page.getByRole("button", { name: "Send message" }).click();
  await page.locator(".message-bubble").filter({ hasText: message }).first().waitFor();
  await shot(page, "ticket-desktop.png");
  await page.reload();
  await page.locator(".message-bubble").filter({ hasText: message }).first().waitFor();
  const reporter = await browser.newContext({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
  });
  const mobile = await reporter.newPage();
  mobile.on("pageerror", (error) => errors.push(error.message));
  await mobile.goto(base);
  await mobile.getByRole("heading", { name: "Welcome back" }).waitFor();
  await shot(mobile, "login-mobile.png");
  await login(mobile, "Reporter");
  await mobile.getByRole("heading", { name: "My requests" }).waitFor();
  await mobile.getByRole("link", { name: /Printer keeps dropping/ }).waitFor();
  await shot(mobile, "mobile.png");
  assert.equal(
    await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "Mobile page overflows",
  );
  await mobile.getByRole("link", { name: /Printer keeps dropping/ }).click();
  await mobile.getByText(message, { exact: true }).waitFor();
  await shot(mobile, "ticket-mobile.png");
  await mobile.getByRole("tab", { name: "Details & activity" }).click();
  await mobile.getByRole("heading", { name: "Activity" }).waitFor();
  await shot(mobile, "details-mobile.png");
  await mobile.getByRole("tab", { name: "Conversation", exact: true }).click();
  const reply = `Thank you. I can test it again after class. [${Date.now()}]`;
  await mobile.getByRole("textbox", { name: "Write a message" }).fill(reply);
  await mobile.getByRole("button", { name: "Send message" }).click();
  await page.getByText(reply, { exact: true }).waitFor();
  await mobile.getByRole("button", { name: "Open navigation" }).click();
  await mobile.getByRole("link", { name: "New request" }).click();
  await mobile.getByRole("heading", { name: "New request" }).waitFor();
  await shot(mobile, "new-request-mobile.png");
  const newSubject = `Test access to a lab computer ${Date.now()}`;
  await mobile.getByLabel("Subject").fill(newSubject);
  await mobile
    .getByLabel("What happened?")
    .fill("The computer cannot connect to the campus network.");
  await mobile.getByRole("button", { name: "Submit request" }).click();
  await mobile.getByRole("heading", { name: newSubject }).waitFor();
  await mobile.getByText("Conversation opens after assignment").waitFor();
  await page.goto(base + "/inbox");
  await page.getByRole("link", { name: new RegExp(newSubject) }).click();
  await page.getByRole("button", { name: "Claim ticket" }).click();
  await page.getByText("Live", { exact: true }).waitFor();
  const admin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const adminPage = await admin.newPage();
  adminPage.on("pageerror", (error) => errors.push(error.message));
  await login(adminPage, "Administrator");
  await adminPage.getByRole("heading", { name: "All tickets" }).waitFor();
  await adminPage.getByRole("link", { name: "User management" }).click();
  await adminPage.getByRole("heading", { name: "User management" }).waitFor();
  await shot(adminPage, "users-desktop.png");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: desktop/mobile login, queue, chat delivery and persistence, ticket creation, claim, and responsive layout",
  );
} finally {
  await browser.close();
}
