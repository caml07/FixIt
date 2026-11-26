import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { io } from "socket.io-client";
import {
  adminId,
  agentId,
  inProgressTicketId,
  openTicketId,
  otherId,
  reporterId,
  resolvedTicketId,
  startFixtures,
  ticketId,
} from "../local/fixtures.js";
import { startChat } from "../src/server.js";
import { scenario } from "./scenario.js";

test("conserva denegaciones HTTP de usuario del servicio Tickets", async (t) => {
  const s = await scenario(t);
  for (const code of [401, 403]) {
    s.fixtures.state.authorizeHttpStatus = code;
    assert.equal((await s.history()).status, code);
  }
});

test("mensaje confirmado se recupera por HTTP y sobrevive reinicio de Chat", async (t) => {
  const fixtures = await startFixtures();
  t.after(() => fixtures.close());
  const options = {
    mongoUri: `${process.env.MONGO_URI}/chat_${randomUUID().replaceAll("-", "")}`,
    authUrl: fixtures.url,
    ticketsUrl: fixtures.url,
    serviceToken: fixtures.serviceToken,
    origin: "http://localhost:8080",
    port: 0,
  };
  let chat = await startChat(options);
  t.after(() => chat.close());
  const socket = io(chat.url, {
    transports: ["websocket"],
    extraHeaders: {
      Origin: options.origin,
      Cookie: "__Host-fixit_session=fixture-reporter",
    },
    reconnection: false,
  });
  t.after(() => socket.disconnect());
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const payload = {
    ticketId,
    clientMessageId: randomUUID(),
    body: "La impresora no responde",
  };
  const ack = await socket.timeout(5000).emitWithAck("chat:send", payload);
  assert.equal(ack.ok, true);
  await chat.close();
  chat = await startChat(options);
  const response = await fetch(
    `${chat.url}/api/v1/tickets/${ticketId}/messages`,
    { headers: { Cookie: "__Host-fixit_session=fixture-reporter" } },
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.data.items.length, 1);
  assert.equal(result.data.items[0].id, ack.data.messageId);
  assert.equal(result.data.items[0].body, payload.body);
});

test("reasignacion permite terminar envio en vuelo pero bloquea agente anterior y sus broadcasts", async (t) => {
  const s = await scenario(t);
  const agent = await s.connect("fixture-agent");
  const reporter = await s.connect();
  await agent.timeout(2000).emitWithAck("ticket:join", { ticketId });
  await reporter.timeout(2000).emitWithAck("ticket:join", { ticketId });
  const oldReceived: unknown[] = [];
  agent.on("chat:message", (message) => oldReceived.push(message));
  const authorized = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  s.fixtures.hooks.afterWriteAuthorization = async () => {
    authorized.resolve();
    await resume.promise;
  };
  t.after(() => resume.resolve());
  const input = {
    ticketId,
    clientMessageId: randomUUID(),
    body: "Ya autorizado",
  };
  const pending = agent.timeout(5000).emitWithAck("chat:send", input);
  await authorized.promise;
  s.fixtures.state.assigneeId = otherId;
  s.fixtures.state.version++;
  const delivered = new Promise<void>((resolve) =>
    reporter.once("chat:message", () => resolve()),
  );
  resume.resolve();
  delete s.fixtures.hooks.afterWriteAuthorization;
  assert.equal((await pending).ok, true);
  await delivered;
  assert.deepEqual(oldReceived, []);
  assert.equal(
    (await agent.timeout(2000).emitWithAck("chat:send", input)).error.code,
    "NOT_FOUND",
  );
  assert.equal(
    (await agent.timeout(2000).emitWithAck("ticket:join", { ticketId })).error
      .code,
    "NOT_FOUND",
  );
  assert.equal((await s.history("fixture-agent")).status, 404);
  assert.equal(
    (await (await s.history("fixture-other")).json()).data.items.length,
    1,
  );
});

test("historial rechaza Origin ajeno y cursor vacio", async (t) => {
  const s = await scenario(t);
  const foreign = await fetch(
    `${s.chat.url}/api/v1/tickets/${ticketId}/messages`,
    {
      headers: {
        Cookie: "__Host-fixit_session=fixture-reporter",
        Origin: "https://evil.invalid",
      },
    },
  );
  assert.equal(foreign.status, 403);
  assert.equal((await s.history("fixture-reporter", "?cursor=")).status, 422);
});

test("reintentos concurrentes persisten una vez, otro texto da conflicto y replay revocado no revela ACK", async (t) => {
  const s = await scenario(t);
  const socket = await s.connect();
  const input = {
    ticketId,
    clientMessageId: randomUUID(),
    body: "  conservar espacios  ",
  };
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      socket.timeout(5000).emitWithAck("chat:send", input),
    ),
  );
  for (const ack of results) {
    assert.equal(ack.ok, true);
    assert.equal(ack.data.messageId, results[0].data.messageId);
  }
  assert.equal(
    (
      await socket
        .timeout(2000)
        .emitWithAck("chat:send", { ...input, body: "Otro" })
    ).error.code,
    "CONFLICT",
  );
  const history = await (await s.history()).json();
  assert.equal(history.data.items.length, 1);
  assert.equal(history.data.items[0].body, input.body);
  const user = s.fixtures.sessions.get("fixture-reporter");
  assert.ok(user);
  user.active = false;
  assert.equal(
    (await socket.timeout(2000).emitWithAck("chat:send", input)).error.code,
    "UNAUTHORIZED",
  );
});

test("valida bytes UTF-8 y rechaza texto vacio, operadores y suplantacion de emisor", async (t) => {
  const s = await scenario(t);
  const socket = await s.connect();
  for (const body of ["", " \n ", "😀".repeat(513), { $ne: null }]) {
    const ack = await socket.timeout(2000).emitWithAck("chat:send", {
      ticketId,
      clientMessageId: randomUUID(),
      body,
    });
    assert.equal(ack.error.code, "VALIDATION_ERROR");
  }
  assert.equal(
    (
      await socket.timeout(2000).emitWithAck("chat:send", {
        ticketId,
        clientMessageId: randomUUID(),
        body: "valido",
        senderId: randomUUID(),
      })
    ).error.code,
    "VALIDATION_ERROR",
  );
  assert.equal(
    (
      await socket.timeout(2000).emitWithAck("chat:send", {
        ticketId,
        clientMessageId: randomUUID(),
        body: "😀".repeat(512),
      })
    ).ok,
    true,
  );
  assert.equal((await (await s.history()).json()).data.items.length, 1);
});

test("paginacion recupera paginas anteriores sin repetir mensajes; cursores invalidos fallan", async (t) => {
  const s = await scenario(t);
  const socket = await s.connect();
  await Promise.all(
    Array.from({ length: 7 }, (_, i) =>
      socket.timeout(3000).emitWithAck("chat:send", {
        ticketId,
        clientMessageId: randomUUID(),
        body: `Mensaje ${i}`,
      }),
    ),
  );
  const all = await (await s.history()).json();
  const found: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await (
      await s.history(
        "fixture-reporter",
        `?limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      )
    ).json();
    found.unshift(...page.data.items.map((m: { id: string }) => m.id));
    cursor = page.data.nextCursor;
  } while (cursor);
  assert.deepEqual(
    found,
    all.data.items.map((m: { id: string }) => m.id),
  );
  assert.equal(new Set(found).size, 7);
  assert.equal(
    (await s.history("fixture-reporter", "?cursor=garbage")).status,
    422,
  );
  assert.equal((await s.history("fixture-reporter", "?limit=101")).status, 422);
  assert.equal(
    (await s.history("fixture-reporter", "", "invalid")).status,
    422,
  );
});

test("OPEN no admite sala; estados finales permiten join e historial pero no envio", async (t) => {
  const s = await scenario(t);
  const socket = await s.connect();
  s.fixtures.state.status = "OPEN";
  assert.equal(
    (await socket.timeout(2000).emitWithAck("ticket:join", { ticketId })).error
      .code,
    "CONFLICT",
  );
  assert.deepEqual((await (await s.history()).json()).data.items, []);
  for (const status of ["RESOLVED", "CLOSED", "CANCELLED"]) {
    s.fixtures.state.status = status;
    assert.equal(
      (await socket.timeout(2000).emitWithAck("ticket:join", { ticketId })).ok,
      true,
    );
    assert.equal(
      (
        await socket.timeout(2000).emitWithAck("chat:send", {
          ticketId,
          clientMessageId: randomUUID(),
          body: "No permitido",
        })
      ).error.code,
      "CONFLICT",
    );
  }
});

test("handshake rechaza Origin ajeno, falta de cookie y sesion restringida sin tumbar el servicio", async (t) => {
  const s = await scenario(t);
  await assert.rejects(s.connect("fixture-reporter", "https://evil.invalid"));
  await assert.rejects(s.connect(""));
  await assert.rejects(s.connect("fixture-restricted"));
  assert.equal((await fetch(`${s.chat.url}/health`)).status, 200);
});

test("Auth o Tickets caidos no autorizan nuevas operaciones", async (t) => {
  const s = await scenario(t);
  const socket = await s.connect();
  for (const key of ["authDown", "ticketsDown"] as const) {
    s.fixtures.state[key] = true;
    assert.equal((await s.history()).status, 503);
    assert.equal(
      (
        await socket.timeout(2000).emitWithAck("chat:send", {
          ticketId,
          clientMessageId: randomUUID(),
          body: "No persistir",
        })
      ).error.code,
      "DEPENDENCY_UNAVAILABLE",
    );
    s.fixtures.state[key] = false;
  }
  assert.deepEqual((await (await s.history()).json()).data.items, []);
});

test("limites se comparten entre sockets y entre historial HTTP y join del mismo usuario", async (t) => {
  const s = await scenario(t, { sendLimit: 1, readLimit: 2 });
  const one = await s.connect();
  const two = await s.connect();
  assert.equal(
    (
      await one.timeout(2000).emitWithAck("chat:send", {
        ticketId,
        clientMessageId: randomUUID(),
        body: "Primero",
      })
    ).ok,
    true,
  );
  assert.equal(
    (
      await two.timeout(2000).emitWithAck("chat:send", {
        ticketId,
        clientMessageId: randomUUID(),
        body: "Segundo",
      })
    ).error?.code,
    "RATE_LIMITED",
  );
  assert.equal((await s.history()).status, 200);
  assert.equal(
    (await one.timeout(2000).emitWithAck("ticket:join", { ticketId })).ok,
    true,
  );
  assert.equal(
    (await two.timeout(2000).emitWithAck("ticket:join", { ticketId })).error
      .code,
    "RATE_LIMITED",
  );
  assert.equal((await s.history()).status, 429);
});

test("Mongo caido no da ACK positivo; al volver acepta el reintento sin duplicar", async (t) => {
  const container = process.env.TEST_MONGO_CONTAINER;
  if (!container) {
    t.skip("Caida controlada disponible en runner con contenedor propio");
    return;
  }
  const s = await scenario(t);
  const socket = await s.connect();
  const engine = process.env.CONTAINER_ENGINE || "podman";
  t.after(() =>
    execFileSync(engine, ["start", container], { stdio: "ignore" }),
  );
  execFileSync(engine, ["stop", "-t", "1", container], { stdio: "ignore" });
  const input = {
    ticketId,
    clientMessageId: randomUUID(),
    body: "Recuperable",
  };
  const failed = await socket.timeout(10000).emitWithAck("chat:send", input);
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "DEPENDENCY_UNAVAILABLE");
  execFileSync(engine, ["start", container], { stdio: "ignore" });
  execFileSync(
    engine,
    [
      "exec",
      container,
      "sh",
      "-c",
      'until mongosh --quiet --eval "db.runCommand({ping:1}).ok" >/dev/null 2>&1; do sleep 1; done',
    ],
    { stdio: "ignore", timeout: 60000 },
  );
  assert.equal(
    (await socket.timeout(10000).emitWithAck("chat:send", input)).ok,
    true,
  );
  assert.equal((await (await s.history()).json()).data.items.length, 1);
});

test("solo destinatarios vigentes reciben mensajes; logout bloquea un socket ya conectado", async (t) => {
  const s = await scenario(t);
  const reporter = await s.connect();
  const agent = await s.connect("fixture-agent");
  const admin = await s.connect("fixture-admin");
  const other = await s.connect("fixture-other");
  for (const socket of [reporter, agent, admin])
    assert.equal(
      (await socket.timeout(2000).emitWithAck("ticket:join", { ticketId })).ok,
      true,
    );
  assert.equal(
    (await other.timeout(2000).emitWithAck("ticket:join", { ticketId })).error
      .code,
    "NOT_FOUND",
  );
  const received: string[] = [];
  reporter.on("chat:message", () => received.push("reporter"));
  other.on("chat:message", () => received.push("other"));
  const user = s.fixtures.sessions.get("fixture-reporter");
  assert.ok(user);
  user.active = false;
  const delivered = new Promise<void>((resolve) =>
    admin.once("chat:message", () => resolve()),
  );
  const ack = await agent.timeout(2000).emitWithAck("chat:send", {
    ticketId,
    clientMessageId: randomUUID(),
    body: "Prueba privada",
  });
  assert.equal(ack.ok, true);
  await delivered;
  assert.deepEqual(received, []);
  assert.equal(
    (
      await reporter.timeout(2000).emitWithAck("chat:send", {
        ticketId,
        clientMessageId: randomUUID(),
        body: "No permitido",
      })
    ).error.code,
    "UNAUTHORIZED",
  );
  assert.equal((await s.history()).status, 401);
  assert.equal((await s.history("fixture-other")).status, 404);
});

test("local preview auth issues host-only secure cookies for synthetic roles", async (t) => {
  const fixtures = await startFixtures();
  t.after(() => fixtures.close());
  const accounts = [
    {
      role: "REPORTER",
      token: "fixture-reporter",
      userId: reporterId,
      displayName: "Alex Morgan",
      email: "alex.morgan@fixit.local",
    },
    {
      role: "SUPPORT_AGENT",
      token: "fixture-agent",
      userId: agentId,
      displayName: "Jordan Lee",
      email: "jordan.lee@fixit.local",
    },
    {
      role: "ADMIN",
      token: "fixture-admin",
      userId: adminId,
      displayName: "Taylor Brooks",
      email: "taylor.brooks@fixit.local",
    },
  ];
  for (const account of accounts) {
    const login = await fetch(`${fixtures.url}/__dev/auth/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: account.role }),
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(
      setCookie,
      new RegExp(
        `__Host-fixit_session=${account.token}; Path=/; Secure; HttpOnly; SameSite=Lax`,
      ),
    );
    const cookie = setCookie.split(";")[0] ?? "";
    const current = await fetch(`${fixtures.url}/__dev/auth/session`, {
      headers: { Cookie: cookie },
    });
    assert.equal(current.status, 200);
    const currentBody = await current.json();
    assert.deepEqual(currentBody.data.user, {
      userId: account.userId,
      role: account.role,
      displayName: account.displayName,
      email: account.email,
    });
    assert.equal(JSON.stringify(currentBody).includes(account.token), false);
    const logout = await fetch(`${fixtures.url}/__dev/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
  }
});

test("preview fixtures authorize separate assigned, in-progress, open and resolved tickets", async (t) => {
  const s = await scenario(t);
  const agent = await s.connect("fixture-agent");
  const activeJoin = await agent.timeout(2000).emitWithAck("ticket:join", {
    ticketId: inProgressTicketId,
  });
  assert.equal(activeJoin.ok, true);
  const activeSend = await agent.timeout(2000).emitWithAck("chat:send", {
    ticketId: inProgressTicketId,
    clientMessageId: randomUUID(),
    body: "Checking the device connection now.",
  });
  assert.equal(activeSend.ok, true);
  const reporter = await s.connect("fixture-reporter");
  const openJoin = await reporter.timeout(2000).emitWithAck("ticket:join", {
    ticketId: openTicketId,
  });
  assert.equal(openJoin.error.code, "CONFLICT");
  assert.equal(
    (await s.history("fixture-agent", "", resolvedTicketId)).status,
    200,
  );
  const resolvedSend = await agent.timeout(2000).emitWithAck("chat:send", {
    ticketId: resolvedTicketId,
    clientMessageId: randomUUID(),
    body: "This is read-only now.",
  });
  assert.equal(resolvedSend.error.code, "CONFLICT");
});

test("local Tickets fixture claim is role-checked and opens Chat for the assignee", async (t) => {
  const s = await scenario(t);
  const cookie = "__Host-fixit_session=fixture-agent";
  const claim = await fetch(
    `${s.fixtures.url}/__dev/tickets/${openTicketId}/claim`,
    {
      method: "POST",
      headers: { Cookie: cookie },
    },
  );
  assert.equal(claim.status, 200);
  const agent = await s.connect("fixture-agent");
  const joined = await agent.timeout(2000).emitWithAck("ticket:join", {
    ticketId: openTicketId,
  });
  assert.equal(joined.ok, true);
  const reporterClaim = await fetch(
    `${s.fixtures.url}/__dev/tickets/${resolvedTicketId}/claim`,
    {
      method: "POST",
      headers: { Cookie: "__Host-fixit_session=fixture-reporter" },
    },
  );
  assert.equal(reporterClaim.status, 403);
});

test("preview login accepts only the three synthetic accounts and local passphrase", async (t) => {
  const fixtures = await startFixtures();
  t.after(() => fixtures.close());
  const login = await fetch(`${fixtures.url}/__dev/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "jordan.lee@fixit.local",
      password: "FixItPreview!",
    }),
  });
  assert.equal(login.status, 200);
  assert.match(
    login.headers.get("set-cookie") ?? "",
    /__Host-fixit_session=fixture-agent; Path=\/; Secure; HttpOnly; SameSite=Lax/,
  );
  const invalidPassword = await fetch(`${fixtures.url}/__dev/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "jordan.lee@fixit.local",
      password: "not-the-preview-password",
    }),
  });
  assert.equal(invalidPassword.status, 401);
  const unknownAccount = await fetch(`${fixtures.url}/__dev/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "real.person@example.com",
      password: "FixItPreview!",
    }),
  });
  assert.equal(unknownAccount.status, 401);
});

test("local ticket preview creates, claims and advances a request before closing Chat", async (t) => {
  const s = await scenario(t);
  const reporterCookie = "__Host-fixit_session=fixture-reporter";
  const created = await fetch(`${s.fixtures.url}/__dev/tickets`, {
    method: "POST",
    headers: { Cookie: reporterCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Shared drive access is denied",
      category: "ACCOUNT_ACCESS",
      description: "The course folder returns access denied for my account.",
      urgency: "NORMAL",
      location: "Library · Workstation 08",
    }),
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  const newTicketId = createdBody.data.ticketId as string;
  const beforeClaim = await s.history("fixture-reporter", "", newTicketId);
  assert.equal(beforeClaim.status, 200);
  const claim = await fetch(
    `${s.fixtures.url}/__dev/tickets/${newTicketId}/claim`,
    {
      method: "POST",
      headers: { Cookie: "__Host-fixit_session=fixture-agent" },
    },
  );
  assert.equal(claim.status, 200);
  const agent = await s.connect("fixture-agent");
  const joined = await agent
    .timeout(2000)
    .emitWithAck("ticket:join", { ticketId: newTicketId });
  assert.equal(joined.ok, true);
  const inProgress = await fetch(
    `${s.fixtures.url}/__dev/tickets/${newTicketId}/state`,
    {
      method: "PATCH",
      headers: {
        Cookie: "__Host-fixit_session=fixture-agent",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    },
  );
  assert.equal(inProgress.status, 200);
  const resolved = await fetch(
    `${s.fixtures.url}/__dev/tickets/${newTicketId}/state`,
    {
      method: "PATCH",
      headers: {
        Cookie: "__Host-fixit_session=fixture-agent",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "RESOLVED" }),
    },
  );
  assert.equal(resolved.status, 200);
  const sendAfterResolve = await agent.timeout(2000).emitWithAck("chat:send", {
    ticketId: newTicketId,
    clientMessageId: randomUUID(),
    body: "This should be read-only.",
  });
  assert.equal(sendAfterResolve.error.code, "CONFLICT");
  const closed = await fetch(
    `${s.fixtures.url}/__dev/tickets/${newTicketId}/state`,
    {
      method: "PATCH",
      headers: { Cookie: reporterCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ status: "CLOSED" }),
    },
  );
  assert.equal(closed.status, 200);
});
