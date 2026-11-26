import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express, { type ErrorRequestHandler } from "express";
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
import { Server } from "socket.io";
import { z } from "zod";
import {
  ChatError,
  errors,
  joinInput,
  type Message,
  publicError,
  sendInput,
  sessionCookie,
  uuid,
} from "./contracts.js";
import { permissions } from "./permissions.js";
import { openStore } from "./store.js";

export type ChatOptions = {
  mongoUri: string;
  authUrl: string;
  ticketsUrl: string;
  serviceToken: string;
  origin: string;
  port: number;
  host?: string;
  timeoutMs?: number;
  sendLimit?: number;
  readLimit?: number;
};
export async function startChat(options: ChatOptions) {
  const store = await openStore(options.mongoUri);
  const access = permissions({
    ...options,
    timeoutMs: options.timeoutMs ?? 3000,
  });
  // shortcut: contadores de un proceso local; usar store compartido antes de replicas.
  const sends = new RateLimiterMemory({
    points: options.sendLimit ?? 30,
    duration: 60,
  });
  const reads = new RateLimiterMemory({
    points: options.readLimit ?? 120,
    duration: 60,
  });
  async function consume(limiter: RateLimiterMemory, userId: string) {
    try {
      await limiter.consume(userId);
    } catch (error) {
      throw new ChatError(
        error instanceof RateLimiterRes
          ? "RATE_LIMITED"
          : "DEPENDENCY_UNAVAILABLE",
      );
    }
  }
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use((req, _res, next) => {
    if (
      (req.headers.origin && req.headers.origin !== options.origin) ||
      req.headers["sec-fetch-site"] === "cross-site"
    )
      throw new ChatError("FORBIDDEN");
    next();
  });
  app.get("/health", (_req, res) =>
    res.json({ data: { status: "ok" }, requestId: randomUUID() }),
  );
  app.get("/api/v1/tickets/:ticketId/messages", async (req, res) => {
    const token = sessionCookie(req.headers.cookie);
    const identity = await access.identity(token);
    await consume(reads, identity.userId);
    const ticketId = uuid.parse(req.params.ticketId);
    const query = z
      .strictObject({
        cursor: z.string().min(1).max(512).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);
    const allowed = await access.authorize(token, ticketId, "chat.read");
    if (allowed.actorId !== identity.userId)
      throw new ChatError("DEPENDENCY_UNAVAILABLE");
    const data = await store.history(ticketId, query.limit, query.cursor);
    res.json({
      data:
        allowed.ticketStatus === "OPEN"
          ? { items: [], nextCursor: null }
          : data,
      requestId: randomUUID(),
    });
  });
  app.use((_req, res) =>
    res.status(404).json({
      error: publicError(new ChatError("NOT_FOUND")),
      requestId: randomUUID(),
    }),
  );
  const errorHandler: ErrorRequestHandler = (
    error: unknown,
    _req,
    res,
    _next,
  ) => {
    const safe = publicError(error);
    res
      .status(errors[safe.code].status)
      .json({ error: safe, requestId: randomUUID() });
  };
  app.use(errorHandler);
  const http = createServer(app);
  const io = new Server(http, {
    transports: ["websocket"],
    maxHttpBufferSize: 16384,
    allowRequest: (req, done) =>
      done(
        null,
        req.headers.origin === options.origin &&
          req.headers["sec-fetch-site"] !== "cross-site",
      ),
  });
  io.use((socket, next) => {
    Promise.resolve()
      .then(() =>
        access.identity(sessionCookie(socket.handshake.headers.cookie)),
      )
      .then(() => next())
      .catch((error) => {
        const safe = publicError(error);
        next(Object.assign(new Error(safe.message), { data: safe }));
      });
  });
  async function broadcast(message: Message) {
    for (const recipient of io.sockets.sockets.values()) {
      if (!recipient.rooms.has(message.ticketId)) continue;
      try {
        const token = sessionCookie(recipient.handshake.headers.cookie);
        const identity = await access.identity(token);
        const current = await access.audience(message.ticketId);
        if (
          identity.role !== "ADMIN" &&
          identity.userId !== current.reporterId &&
          identity.userId !== current.assigneeId
        )
          throw new ChatError("NOT_FOUND");
        const allowed = await access.authorize(
          token,
          message.ticketId,
          "chat.read",
        );
        if (allowed.actorId !== identity.userId)
          throw new ChatError("DEPENDENCY_UNAVAILABLE");
        if (recipient.connected && recipient.rooms.has(message.ticketId))
          recipient.emit("chat:message", message);
      } catch (error) {
        if (publicError(error).code !== "DEPENDENCY_UNAVAILABLE")
          await recipient.leave(message.ticketId);
      }
    }
  }
  io.on("connection", (socket) => {
    socket.on("ticket:join", async (input: unknown, ack: unknown) => {
      if (typeof ack !== "function") return;
      try {
        const token = sessionCookie(socket.handshake.headers.cookie);
        const identity = await access.identity(token);
        await consume(reads, identity.userId);
        const { ticketId } = joinInput.parse(input);
        const allowed = await access.authorize(
          token,
          ticketId,
          "chat.subscribe",
        );
        if (allowed.actorId !== identity.userId)
          throw new ChatError("DEPENDENCY_UNAVAILABLE");
        if (allowed.ticketStatus === "OPEN") throw new ChatError("CONFLICT");
        await socket.join(ticketId);
        ack({ ok: true, data: { ticketId, version: allowed.ticketVersion } });
      } catch (error) {
        ack({ ok: false, error: publicError(error) });
      }
    });
    socket.on("ticket:leave", async (input: unknown, ack: unknown) => {
      if (typeof ack !== "function") return;
      try {
        const { ticketId } = joinInput.parse(input);
        await socket.leave(ticketId);
        ack({ ok: true });
      } catch (error) {
        ack({ ok: false, error: publicError(error) });
      }
    });
    socket.on("chat:send", async (input: unknown, ack: unknown) => {
      if (typeof ack !== "function") return;
      try {
        const token = sessionCookie(socket.handshake.headers.cookie);
        const identity = await access.identity(token);
        await consume(sends, identity.userId);
        const data = sendInput.parse(input);
        const allowed = await access.authorize(
          token,
          data.ticketId,
          "chat.write",
        );
        if (allowed.actorId !== identity.userId)
          throw new ChatError("DEPENDENCY_UNAVAILABLE");
        if (!["ASSIGNED", "IN_PROGRESS"].includes(allowed.ticketStatus))
          throw new ChatError("CONFLICT");
        const saved = await store.save({ ...data, senderId: identity.userId });
        const m = saved.message;
        ack({
          ok: true,
          data: {
            messageId: m.id,
            ticketId: m.ticketId,
            senderId: m.senderId,
            createdAt: m.createdAt,
            clientMessageId: m.clientMessageId,
          },
        });
        if (saved.inserted) await broadcast(m);
      } catch (error) {
        ack({ ok: false, error: publicError(error) });
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      http.once("error", reject);
      http.listen(options.port, options.host ?? "127.0.0.1", resolve);
    });
  } catch (error) {
    await store.close();
    throw error;
  }
  const address = http.address();
  if (!address || typeof address === "string")
    throw new Error("Missing TCP address");
  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await store.close();
    },
  };
}
