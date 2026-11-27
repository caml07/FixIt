import express, { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { AppDependencies } from "./app.js";
import { authenticateToken } from "./auth.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function matches(left: string, right: string) {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
}

export function internalRoutes(dependencies?: AppDependencies) {
  const router = Router();
  router.use("/internal/v1/tickets", (req, res, next) => {
    const requestId = randomUUID();
    const failure = (status: number, code: string) => res.status(status).json({ error: { code, message: "Internal authorization failed." }, requestId });
    if (!dependencies?.chatServiceToken || dependencies.chatServiceToken === dependencies.serviceToken) return failure(503, "DEPENDENCY_UNAVAILABLE");
    const header = req.get("authorization") ?? "";
    if (!header.startsWith("Bearer ") || !header.slice(7)) return failure(401, "UNAUTHORIZED");
    const token = header.slice(7);
    if (matches(token, dependencies.serviceToken)) return failure(403, "FORBIDDEN");
    if (!matches(token, dependencies.chatServiceToken)) return failure(401, "UNAUTHORIZED");
    return next();
  });
  router.get("/internal/v1/tickets/chat-snapshot", async (req, res) => {
    const requestId = randomUUID();
    const failure = (status: number, code: string) => res.status(status).json({ error: { code, message: "Request could not be completed." }, requestId });
    if (!dependencies) return failure(503, "DEPENDENCY_UNAVAILABLE");
    const cursor = req.query.cursor;
    const rawLimit = req.query.limit ?? "100";
    if ((cursor !== undefined && (typeof cursor !== "string" || !uuid.test(cursor))) ||
        typeof rawLimit !== "string" || !/^[0-9]+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
      return failure(422, "VALIDATION_ERROR");
    }
    const limit = Number(rawLimit);
    try {
      const result = await dependencies.database.query(`SELECT id AS "ticketId", reporter_id AS "reporterId",
        assignee_id AS "assigneeId", status, version FROM tickets.support_tickets
        WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id ASC LIMIT $2`, [cursor ?? null, limit + 1]);
      const items = result.rows.slice(0, limit);
      return res.status(200).json({ data: { items, page: { nextCursor: result.rows.length > limit ? items[items.length - 1].ticketId : null } }, requestId });
    } catch {
      return failure(503, "DEPENDENCY_UNAVAILABLE");
    }
  });
  router.get("/internal/v1/tickets/:ticketId/chat-audience", async (req, res) => {
    const requestId = randomUUID();
    const failure = (status: number, code: string) => res.status(status).json({ error: { code, message: "Request could not be completed." }, requestId });
    if (!dependencies) return failure(503, "DEPENDENCY_UNAVAILABLE");
    if (typeof req.params.ticketId !== "string" || !uuid.test(req.params.ticketId)) return failure(404, "NOT_FOUND");
    try {
      const result = await dependencies.database.query(`SELECT reporter_id AS "reporterId", assignee_id AS "assigneeId",
        status, version FROM tickets.support_tickets WHERE id = $1`, [req.params.ticketId]);
      if (!result.rowCount) return failure(404, "NOT_FOUND");
      return res.status(200).json({ data: result.rows[0], requestId });
    } catch {
      return failure(503, "DEPENDENCY_UNAVAILABLE");
    }
  });
  router.post("/internal/v1/tickets/:ticketId/authorize", express.text({ type: "application/json", limit: "8kb" }), async (req: Request, res: Response) => {
    const requestId = randomUUID();
    const failure = (status: number, code: string) => res.status(status).json({ error: { code, message: "Request could not be completed." }, requestId });
    if (!dependencies) return failure(503, "DEPENDENCY_UNAVAILABLE");
    if (typeof req.params.ticketId !== "string" || !uuid.test(req.params.ticketId)) return failure(404, "NOT_FOUND");
    let body: unknown;
    try { body = JSON.parse(req.body); } catch { return failure(403, "FORBIDDEN"); }
    if (typeof body !== "object" || body === null || Array.isArray(body) ||
        Object.keys(body).some((key) => !["sessionToken", "action"].includes(key)) ||
        !("sessionToken" in body) || typeof body.sessionToken !== "string" || body.sessionToken.length < 1 || body.sessionToken.length > 256 ||
        !("action" in body) || (body.action !== "chat.read" && body.action !== "chat.write" && body.action !== "chat.subscribe")) return failure(403, "FORBIDDEN");
    const session = await authenticateToken(body.sessionToken, dependencies.authUrl, dependencies.serviceToken);
    if (session.kind === "unavailable") return failure(503, "DEPENDENCY_UNAVAILABLE");
    if (session.kind === "invalid") return failure(401, "UNAUTHORIZED");
    try {
      const result = await dependencies.database.query(`SELECT status, version FROM tickets.support_tickets WHERE id = $1
        AND ($2::text = 'ADMIN' OR ($2 = 'REPORTER' AND reporter_id = $3)
        OR ($2 = 'SUPPORT_AGENT' AND assignee_id = $3))`, [req.params.ticketId, session.role, session.userId]);
      if (!result.rowCount) return failure(404, "NOT_FOUND");
      const ticket = result.rows[0];
      if ((body.action === "chat.subscribe" && ticket.status === "OPEN") ||
          (body.action === "chat.write" && !["ASSIGNED", "IN_PROGRESS"].includes(ticket.status))) {
        return res.status(200).json({ data: { allowed: false, code: "CONFLICT" }, requestId });
      }
      return res.status(200).json({ data: { allowed: true, actorId: session.userId, ticketVersion: ticket.version, ticketStatus: ticket.status }, requestId });
    } catch {
      return failure(503, "DEPENDENCY_UNAVAILABLE");
    }
  }, (error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof Error) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Invalid request." }, requestId: randomUUID() });
    return next(error);
  });
  return router;
}
