import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import { createAuthApp } from "../src/app.ts";

test("login enforces its configured limit despite forged forwarding headers", async () => {
  const origin = "https://fixit.example.invalid";
  const database = { user: { findFirst: async () => null } };
  const server = createServer(createAuthApp({ database, publicOrigin: origin, csrfKey: randomUUID(),
    serviceTokens: [randomUUID(), randomUUID()], rateLimits: { login: 2, admin: 3, activation: 4 } }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/auth/login`, {
        method: "POST", headers: { Origin: origin, "Content-Type": "application/json",
          "X-Forwarded-For": `198.51.100.${attempt + 1}` },
        body: JSON.stringify({ email: "user@invalid.example", password: randomUUID() }),
      });
      assert.equal(response.status, attempt < 2 ? 401 : 429);
      if (attempt === 2) assert.ok(response.headers.get("retry-after"));
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
