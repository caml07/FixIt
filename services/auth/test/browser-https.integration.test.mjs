import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import argon2 from "argon2";
import { createAuthApp } from "../src/app.ts";
import { openAuthDatabase } from "../src/db.ts";

test("browser activates an account and uses a secure session through local HTTPS proxy", {
  skip: !process.env.FIXIT_BROWSER_PATH || !process.env.FIXIT_OPENSSL_PATH,
  timeout: 45000,
}, async () => {
  const { FIXIT_TEST_DB_URL: dbUrl, FIXIT_BROWSER_PATH: browser, FIXIT_OPENSSL_PATH: openssl } = process.env;
  assert.ok(dbUrl && browser && openssl);
  const directory = await mkdtemp(join(tmpdir(), "fixit-auth-browser-"));
  const keyPath = join(directory, "key.pem");
  const certPath = join(directory, "cert.pem");
  const db = openAuthDatabase(dbUrl);
  let upstream;
  let proxy;
  try {
    const cert = spawnSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-subj", "/CN=localhost", "-keyout", keyPath, "-out", certPath], { encoding: "utf8", timeout: 15000 });
    assert.equal(cert.status, 0, "could not create temporary local TLS certificate");
    const email = `browser.${randomUUID()}@invalid.example`;
    const password = randomBytes(32).toString("base64url");
    const newPassword = randomBytes(32).toString("base64url");
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await db.user.create({ data: { email, passwordHash, displayName: "Browser Test", role: "REPORTER",
      accountStatus: "PENDING_PASSWORD_CHANGE", temporaryExpiresAt: new Date(Date.now() + 3600000) } });
    let upstreamPort;
    const page = `<!doctype html><body>pending<script>
      (async () => {
        const send = (url, options = {}) => fetch(url, { credentials: 'same-origin', ...options });
        const login = await send('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(${JSON.stringify({ email, password })}) });
        const loginData = await login.json();
        const me = await send('/api/v1/auth/me');
        const meData = await me.json();
        const csrfResponse = await send('/api/v1/auth/csrf');
        const csrf = (await csrfResponse.json()).data.csrfToken;
        const cookieHidden = !document.cookie.includes('__Host-fixit_session');
        const activationBody = JSON.stringify(${JSON.stringify({ currentPassword: password, newPassword })});
        const denied = await send('/api/v1/auth/password/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: activationBody });
        const activation = await send('/api/v1/auth/password/activate', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: activationBody });
        const afterActivation = await send('/api/v1/auth/me');
        const oldLogin = await send('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(${JSON.stringify({ email, password })}) });
        const newLogin = await send('/api/v1/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(${JSON.stringify({ email, password: newPassword })}) });
        const newLoginData = await newLogin.json();
        const fullCsrf = (await (await send('/api/v1/auth/csrf')).json()).data.csrfToken;
        const logout = await send('/api/v1/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': fullCsrf } });
        const after = await send('/api/v1/auth/me');
        document.body.textContent = JSON.stringify({ login: login.status, mustChange: loginData.data.mustChangePassword,
          me: me.status, meMustChange: meData.data.mustChangePassword, csrf: csrfResponse.status, cookieHidden,
          denied: denied.status, activation: activation.status, afterActivation: afterActivation.status,
          oldLogin: oldLogin.status, newLogin: newLogin.status, newMustChange: newLoginData.data.mustChangePassword,
          logout: logout.status, after: after.status });
      })().catch(() => { document.body.textContent = 'browser-flow-failed'; });
    </script></body>`;
    proxy = createHttpsServer({ key: await readFile(keyPath), cert: await readFile(certPath) }, (req, res) => {
      if (req.url === "/") { res.writeHead(200, { "Content-Type": "text/html" }); res.end(page); return; }
      const outgoing = httpRequest({ hostname: "127.0.0.1", port: upstreamPort, path: req.url, method: req.method, headers: req.headers }, (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
      });
      outgoing.on("error", () => { res.writeHead(502); res.end(); });
      req.pipe(outgoing);
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const address = proxy.address();
    assert(address && typeof address !== "string");
    const origin = `https://127.0.0.1:${address.port}`;
    upstream = createHttpServer(createAuthApp({ database: db, publicOrigin: origin, csrfKey: randomUUID(),
      serviceTokens: [randomUUID(), randomUUID()] }));
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    const upstreamAddress = upstream.address();
    assert(upstreamAddress && typeof upstreamAddress !== "string");
    upstreamPort = upstreamAddress.port;
    const result = await new Promise((resolve, reject) => {
      const child = spawn(browser, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        "--ignore-certificate-errors", `--user-data-dir=${join(directory, "profile")}`, "--virtual-time-budget=15000", "--dump-dom", origin],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"], timeout: 25000 });
      let output = "";
      child.stdout.on("data", (data) => { output += data; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, output }));
    });
    assert.equal(result.code, 0, "browser failed to run");
    const match = result.output.match(/<body>(\{[^<]+\})<\/body>/);
    assert.ok(match, "browser did not finish the HTTPS flow");
    assert.deepEqual(JSON.parse(match[1]), { login: 200, mustChange: true, me: 200, meMustChange: true,
      csrf: 200, cookieHidden: true, denied: 403, activation: 204, afterActivation: 401,
      oldLogin: 401, newLogin: 200, newMustChange: false, logout: 204, after: 401 });
  } finally {
    if (proxy) await new Promise((resolve) => proxy.close(resolve));
    if (upstream) await new Promise((resolve) => upstream.close(resolve));
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
