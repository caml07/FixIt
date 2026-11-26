import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { z } from "zod";

export const ticketId = "11111111-1111-4111-8111-111111111111";
export const inProgressTicketId = "66666666-6666-4666-8666-666666666666";
export const openTicketId = "77777777-7777-4777-8777-777777777777";
export const resolvedTicketId = "88888888-8888-4888-8888-888888888888";
export const reporterId = "22222222-2222-4222-8222-222222222222";
export const agentId = "33333333-3333-4333-8333-333333333333";
export const otherId = "44444444-4444-4444-8444-444444444444";
export const adminId = "55555555-5555-4555-8555-555555555555";
export async function startFixtures(
  options: { port?: number; host?: string; serviceToken?: string } = {},
) {
  const serviceToken = options.serviceToken ?? randomUUID();
  const sessions = new Map([
    [
      "fixture-reporter",
      { userId: reporterId, role: "REPORTER", active: true },
    ],
    ["fixture-agent", { userId: agentId, role: "SUPPORT_AGENT", active: true }],
    ["fixture-other", { userId: otherId, role: "REPORTER", active: true }],
    ["fixture-admin", { userId: adminId, role: "ADMIN", active: true }],
    [
      "fixture-restricted",
      { userId: reporterId, role: "REPORTER", active: false },
    ],
  ]);
  const demoAccounts = {
    REPORTER: {
      token: "fixture-reporter",
      role: "REPORTER",
      userId: reporterId,
      displayName: "Alex Morgan",
      email: "alex.morgan@fixit.local",
    },
    SUPPORT_AGENT: {
      token: "fixture-agent",
      role: "SUPPORT_AGENT",
      userId: agentId,
      displayName: "Jordan Lee",
      email: "jordan.lee@fixit.local",
    },
    ADMIN: {
      token: "fixture-admin",
      role: "ADMIN",
      userId: adminId,
      displayName: "Taylor Brooks",
      email: "taylor.brooks@fixit.local",
    },
  } as const;
  const state = {
    authorizeHttpStatus: 200,
    status: "ASSIGNED",
    assigneeId: agentId as string | null,
    version: 2,
    priority: "P2_HIGH",
    authDown: false,
    ticketsDown: false,
  };
  const ticketStates = new Map<
    string,
    {
      status: string;
      assigneeId: string | null;
      version: number;
      priority?: string | null;
    }
  >([
    [ticketId, state],
    [
      inProgressTicketId,
      {
        status: "IN_PROGRESS",
        assigneeId: agentId,
        version: 3,
        priority: "P1_CRITICAL",
      },
    ],
    [
      openTicketId,
      { status: "OPEN", assigneeId: null, version: 1, priority: null },
    ],
    [
      resolvedTicketId,
      {
        status: "RESOLVED",
        assigneeId: agentId,
        version: 4,
        priority: "P3_NORMAL",
      },
    ],
  ]);
  const createdTickets = new Map<
    string,
    {
      title: string;
      category: string;
      description: string;
      urgency: string;
      location?: string;
      equipment?: string;
      reference: string;
      createdAt: string;
      reporterId: string;
      reporterName: string;
    }
  >();
  const hooks: { afterWriteAuthorization?: () => Promise<void> } = {};
  const app = express();
  app.use(express.json({ limit: "4kb" }));
  const demoSession = (cookie: string | undefined) => {
    const value = (cookie ?? "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("__Host-fixit_session="));
    const token = value?.slice("__Host-fixit_session=".length);
    if (!token) return undefined;
    return Object.values(demoAccounts).find(
      (account) => account.token === token,
    );
  };
  app.post("/__dev/auth/login", (req, res) => {
    const parsed = z
      .object({ email: z.email(), password: z.string().min(1).max(128) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Enter a valid preview account.",
        },
        requestId: randomUUID(),
      });
      return;
    }
    const account = Object.values(demoAccounts).find(
      (candidate) => candidate.email === parsed.data.email,
    );
    if (!account || parsed.data.password !== "FixItPreview!") {
      res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Email or password is incorrect.",
        },
        requestId: randomUUID(),
      });
      return;
    }
    res.setHeader(
      "Set-Cookie",
      `__Host-fixit_session=${account.token}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    );
    res.json({
      data: {
        user: {
          userId: account.userId,
          role: account.role,
          displayName: account.displayName,
          email: account.email,
        },
      },
      requestId: randomUUID(),
    });
  });
  app.post("/__dev/auth/session", (req, res) => {
    const parsed = z
      .object({ role: z.enum(["REPORTER", "SUPPORT_AGENT", "ADMIN"]) })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: { code: "VALIDATION_ERROR", message: "Choose a preview role." },
        requestId: randomUUID(),
      });
      return;
    }
    const account = demoAccounts[parsed.data.role];
    res.setHeader(
      "Set-Cookie",
      `__Host-fixit_session=${account.token}; Path=/; Secure; HttpOnly; SameSite=Lax`,
    );
    res.json({
      data: {
        user: {
          userId: account.userId,
          role: parsed.data.role,
          displayName: account.displayName,
          email: account.email,
        },
      },
      requestId: randomUUID(),
    });
  });
  app.get("/__dev/auth/session", (req, res) => {
    const account = demoSession(req.headers.cookie);
    if (!account || !sessions.get(account.token)?.active) {
      res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "No preview session." },
        requestId: randomUUID(),
      });
      return;
    }
    res.json({
      data: {
        user: {
          userId: account.userId,
          role: account.role,
          displayName: account.displayName,
          email: account.email,
        },
      },
      requestId: randomUUID(),
    });
  });
  app.get("/__dev/tickets", (req, res) => {
    const account = demoSession(req.headers.cookie);
    if (!account || !sessions.get(account.token)?.active) {
      res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "No preview session." },
        requestId: randomUUID(),
      });
      return;
    }
    const items = [...ticketStates].map(([id, ticket]) => ({
      id,
      status: ticket.status,
      assigneeId: ticket.assigneeId,
      version: ticket.version,
      priority: ticket.priority ?? null,
      ...(createdTickets.get(id) ?? {}),
    }));
    res.json({ data: { items }, requestId: randomUUID() });
  });
  app.post("/__dev/tickets", (req, res) => {
    const account = demoSession(req.headers.cookie);
    if (!account || !sessions.get(account.token)?.active) {
      res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "No preview session." },
        requestId: randomUUID(),
      });
      return;
    }
    if (account.role !== "REPORTER") {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Only a reporter can create a request.",
        },
        requestId: randomUUID(),
      });
      return;
    }
    const parsed = z
      .object({
        title: z.string().trim().min(5).max(120),
        category: z.string().trim().min(1).max(40),
        description: z.string().trim().min(10).max(2000),
        urgency: z.enum(["LOW", "NORMAL", "HIGH"]),
        location: z.string().trim().max(120).optional(),
        equipment: z.string().trim().max(120).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Check the request details and try again.",
        },
        requestId: randomUUID(),
      });
      return;
    }
    const id = randomUUID();
    createdTickets.set(id, {
      ...parsed.data,
      reference: `FX-${1043 + createdTickets.size}`,
      createdAt: new Date().toISOString(),
      reporterId: account.userId,
      reporterName: account.displayName,
    });
    ticketStates.set(id, {
      status: "OPEN",
      assigneeId: null,
      version: 1,
      priority: null,
    });
    res.status(201).json({
      data: { ticketId: id, version: 1, ...createdTickets.get(id) },
      requestId: randomUUID(),
    });
  });
  app.post("/__dev/tickets/:id/claim", (req, res) => {
    const account = demoSession(req.headers.cookie);
    if (!account || !sessions.get(account.token)?.active) {
      res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "No preview session." },
        requestId: randomUUID(),
      });
      return;
    }
    if (account.role !== "SUPPORT_AGENT") {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Only a support agent can claim a ticket.",
        },
        requestId: randomUUID(),
      });
      return;
    }
    const ticket = ticketStates.get(req.params.id);
    if (!ticket) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "Ticket not found." },
        requestId: randomUUID(),
      });
      return;
    }
    if (ticket.status !== "OPEN" || ticket.assigneeId !== null) {
      res.status(409).json({
        error: { code: "CONFLICT", message: "Ticket is no longer available." },
        requestId: randomUUID(),
      });
      return;
    }
    ticket.status = "ASSIGNED";
    ticket.assigneeId = account.userId;
    ticket.version += 1;
    res.json({
      data: {
        ticketId: req.params.id,
        status: ticket.status,
        assigneeId: ticket.assigneeId,
        version: ticket.version,
      },
      requestId: randomUUID(),
    });
  });
  app.patch("/__dev/tickets/:id/state", (req, res) => {
    const account = demoSession(req.headers.cookie);
    if (!account || !sessions.get(account.token)?.active) {
      res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "No preview session." },
        requestId: randomUUID(),
      });
      return;
    }
    const ticket = ticketStates.get(req.params.id);
    if (!ticket) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "Ticket not found." },
        requestId: randomUUID(),
      });
      return;
    }
    const parsed = z
      .object({
        status: z.enum(["IN_PROGRESS", "RESOLVED", "CLOSED", "CANCELLED"]),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: { code: "VALIDATION_ERROR", message: "Invalid status." },
        requestId: randomUUID(),
      });
      return;
    }
    const next = parsed.data.status;
    const allowedTransition =
      (ticket.status === "ASSIGNED" && next === "IN_PROGRESS") ||
      (ticket.status === "IN_PROGRESS" && next === "RESOLVED") ||
      (ticket.status === "RESOLVED" && next === "CLOSED") ||
      (ticket.status === "OPEN" && next === "CANCELLED");
    const isAssignedAgent =
      account.role === "SUPPORT_AGENT" && ticket.assigneeId === account.userId;
    const isReporterClose =
      account.role === "REPORTER" &&
      ticket.status === "RESOLVED" &&
      next === "CLOSED";
    const isReporterCancel =
      account.role === "REPORTER" &&
      ticket.status === "OPEN" &&
      next === "CANCELLED";
    if (
      !allowedTransition ||
      !(
        isAssignedAgent ||
        isReporterClose ||
        isReporterCancel ||
        account.role === "ADMIN"
      )
    ) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "This transition is not available to this account.",
        },
        requestId: randomUUID(),
      });
      return;
    }
    ticket.status = next;
    ticket.version += 1;
    res.json({
      data: { status: ticket.status, version: ticket.version },
      requestId: randomUUID(),
    });
  });
  app.patch("/__dev/tickets/:id/priority", (req, res) => {
    const account = demoSession(req.headers.cookie);
    if (!account || !sessions.get(account.token)?.active) {
      res.status(401).json({
        error: { code: "UNAUTHORIZED", message: "No preview session." },
        requestId: randomUUID(),
      });
      return;
    }
    const ticket = ticketStates.get(req.params.id);
    if (!ticket) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "Ticket not found." },
        requestId: randomUUID(),
      });
      return;
    }
    const parsed = z
      .object({
        priority: z.enum(["P1_CRITICAL", "P2_HIGH", "P3_NORMAL", "P4_LOW"]),
        reason: z.string().trim().min(10).max(500).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Enter a valid priority and reason.",
        },
        requestId: randomUUID(),
      });
      return;
    }
    const canSet =
      account.role === "ADMIN" ||
      (account.role === "SUPPORT_AGENT" &&
        ticket.assigneeId === account.userId);
    if (!canSet || !["ASSIGNED", "IN_PROGRESS"].includes(ticket.status)) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Only the assigned agent or an admin can set priority.",
        },
        requestId: randomUUID(),
      });
      return;
    }
    if (ticket.priority && !parsed.data.reason) {
      res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "A reason is required when changing priority.",
        },
        requestId: randomUUID(),
      });
      return;
    }
    ticket.priority = parsed.data.priority;
    ticket.version += 1;
    res.json({
      data: { priority: ticket.priority, version: ticket.version },
      requestId: randomUUID(),
    });
  });
  app.post("/__dev/auth/logout", (_req, res) => {
    res.setHeader(
      "Set-Cookie",
      "__Host-fixit_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax",
    );
    res.json({ data: { ok: true }, requestId: randomUUID() });
  });
  app.use((req, res, next) => {
    if (req.headers.authorization !== `Bearer ${serviceToken}`) {
      res.status(403).end();
      return;
    }
    next();
  });
  app.post("/internal/v1/sessions/introspect", (req, res) => {
    if (state.authDown) {
      res.status(503).end();
      return;
    }
    const parsed = z.object({ sessionToken: z.string() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(422).end();
      return;
    }
    const user = sessions.get(parsed.data.sessionToken);
    res.json({
      data: user?.active
        ? {
            active: true,
            subject: { userId: user.userId, role: user.role },
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }
        : { active: false },
      requestId: randomUUID(),
    });
  });
  app.post("/internal/v1/tickets/:id/authorize", async (req, res) => {
    if (state.authorizeHttpStatus !== 200) {
      res.status(state.authorizeHttpStatus).json({
        error: {
          code:
            state.authorizeHttpStatus === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
          message: "Fixture denial",
        },
        requestId: randomUUID(),
      });
      return;
    }
    if (state.authDown || state.ticketsDown) {
      res.status(503).end();
      return;
    }
    const parsed = z
      .object({
        sessionToken: z.string(),
        action: z.enum(["chat.read", "chat.write", "chat.subscribe"]),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(422).end();
      return;
    }
    const user = sessions.get(parsed.data.sessionToken);
    const ticket = ticketStates.get(req.params.id);
    let code: string | undefined;
    if (!user?.active) code = "UNAUTHORIZED";
    else if (
      !ticket ||
      !(
        user.userId === reporterId ||
        user.userId === ticket.assigneeId ||
        user.role === "ADMIN"
      )
    )
      code = "NOT_FOUND";
    else if (
      parsed.data.action === "chat.write" &&
      !["ASSIGNED", "IN_PROGRESS"].includes(ticket.status)
    )
      code = "CONFLICT";
    else if (
      parsed.data.action === "chat.subscribe" &&
      ticket.status === "OPEN"
    )
      code = "CONFLICT";
    const data =
      code || !user || !ticket
        ? { allowed: false, code }
        : {
            allowed: true,
            actorId: user.userId,
            ticketStatus: ticket.status,
            ticketVersion: ticket.version,
          };
    if (!code && parsed.data.action === "chat.write")
      await hooks.afterWriteAuthorization?.();
    res.json({ data, requestId: randomUUID() });
  });
  app.get("/internal/v1/tickets/:id/chat-audience", (req, res) => {
    if (state.ticketsDown) {
      res.status(503).end();
      return;
    }
    const ticket = ticketStates.get(req.params.id);
    if (!ticket) {
      res.status(404).end();
      return;
    }
    res.json({
      data: {
        reporterId,
        assigneeId: ticket.assigneeId,
        status: ticket.status,
        version: ticket.version,
      },
      requestId: randomUUID(),
    });
  });
  const http = createServer(app);
  await new Promise<void>((resolve) =>
    http.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve),
  );
  const address = http.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    serviceToken,
    sessions,
    state,
    hooks,
    close: () => new Promise<void>((resolve) => http.close(() => resolve())),
  };
}
