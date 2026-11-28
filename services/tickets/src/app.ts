import express, { type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { checkoutTicketsDatabase } from "./database.js";
import { authenticate } from "./auth.js";
import { mutationRoutes } from "./mutations.js";
import { internalRoutes } from "./internal.js";
import { attachmentRoutes } from "./attachments.js";
import type { AttachmentStorage } from "./attachment-storage.js";

export interface AppDependencies {
  database: Pool;
  authUrl: string;
  serviceToken: string;
  publicOrigin?: string;
  verifyCsrf?: (token: string, sessionToken: string) => Promise<boolean>;
  chatServiceToken?: string;
  attachmentStorage?: AttachmentStorage;
}

export function createApp(isDraining: () => boolean = () => false, dependencies?: AppDependencies) {
  const app = express();
  app.get("/health", (_req, res) => {
    if (isDraining()) {
      res.status(503).json({ error: { code: "SERVICE_UNAVAILABLE", message: "Service is shutting down." }, requestId: randomUUID() });
      return;
    }
    res.status(200).json({ data: { status: "ok" }, requestId: randomUUID() });
  });
  app.get("/api/v1/categories", async (req, res) => {
    const requestId = randomUUID();
    const error = (status: number, code: string, message: string) =>
      res.status(status).json({ error: { code, message }, requestId });
    if (!req.get("cookie")) return error(401, "UNAUTHENTICATED", "Session is invalid.");
    if (!dependencies) return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    try {
      const session = await authenticate(req.get("cookie") ?? "", dependencies.authUrl, dependencies.serviceToken);
      if (session.kind === "unavailable") return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
      if (session.kind === "invalid") return error(401, "UNAUTHENTICATED", "Session is invalid.");
      const result = await dependencies.database.query("SELECT code, label FROM tickets.categories WHERE is_active = true ORDER BY code");
      return res.status(200).json({ data: { items: result.rows }, requestId });
    } catch {
      return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    }
  });
  app.post("/api/v1/tickets", express.json({ limit: "128kb" }), async (req, res) => {
    const requestId = randomUUID();
    const error = (status: number, code: string, message: string) =>
      res.status(status).json({ error: { code, message }, requestId });
    if (!req.get("cookie")) return error(401, "UNAUTHENTICATED", "Session is invalid.");
    if (!dependencies) return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    const session = await authenticate(req.get("cookie") ?? "", dependencies.authUrl, dependencies.serviceToken);
    if (session.kind === "unavailable") return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    if (session.kind === "invalid") return error(401, "UNAUTHENTICATED", "Session is invalid.");
    if (session.role !== "REPORTER") return error(403, "FORBIDDEN", "Permission denied.");
    const csrf = req.get("x-csrf-token");
    if (!dependencies.publicOrigin || req.get("origin") !== dependencies.publicOrigin ||
        req.get("sec-fetch-site") === "cross-site" || !csrf || !dependencies.verifyCsrf ||
        !(await dependencies.verifyCsrf(csrf, session.sessionToken).catch(() => false))) {
      return error(403, "FORBIDDEN", "Request verification failed.");
    }
    const body: unknown = req.body;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return error(422, "VALIDATION_ERROR", "Invalid ticket.");
    }
    const fields = Object.keys(body);
    if (fields.some((field) => !["title", "description", "category", "reporterUrgency", "location", "equipment"].includes(field)) ||
        !("title" in body) || typeof body.title !== "string" || !body.title.trim() || Array.from(body.title).length > 160 ||
        !("description" in body) || typeof body.description !== "string" || !body.description.trim() || Array.from(body.description).length > 5000 ||
        !("category" in body) || typeof body.category !== "string" || !body.category || Array.from(body.category).length > 40 ||
        !("reporterUrgency" in body) || typeof body.reporterUrgency !== "string" || !["LOW", "NORMAL", "HIGH"].includes(body.reporterUrgency) ||
        ("location" in body && (typeof body.location !== "string" || Array.from(body.location).length > 160)) ||
        ("equipment" in body && (typeof body.equipment !== "string" || Array.from(body.equipment).length > 160))) {
      return error(422, "VALIDATION_ERROR", "Invalid ticket.");
    }
    const client = await checkoutTicketsDatabase(dependencies.database).catch(() => null);
    if (!client) return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    try {
      await client.query("BEGIN");
      const category = await client.query("SELECT code FROM tickets.categories WHERE code = $1 AND is_active = true FOR SHARE", [body.category]);
      if (!category.rowCount) {
        await client.query("ROLLBACK");
        return error(422, "VALIDATION_ERROR", "Invalid category.");
      }
      const result = await client.query(`INSERT INTO tickets.support_tickets
        (reporter_id, category_code, title, description, location, equipment, reporter_urgency)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, reporter_id AS "reporterId", assignee_id AS "assigneeId",
          category_code AS category, title, description, location, equipment,
          reporter_urgency AS "reporterUrgency", effective_priority AS "effectivePriority",
          status, version, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [session.userId, body.category, body.title, body.description, "location" in body ? body.location : null,
          "equipment" in body ? body.equipment : null, body.reporterUrgency]);
      const ticket = result.rows[0];
      await client.query("INSERT INTO tickets.ticket_timeline (ticket_id, actor_user_id, event_type, ticket_version, to_status, to_urgency) VALUES ($1, $2, 'CREATED', 1, 'OPEN', $3)", [ticket.id, session.userId, body.reporterUrgency]);
      const eventId = randomUUID();
      const event = { eventId, type: "ticket.created.v1", schemaVersion: 1, aggregateId: ticket.id,
        aggregateVersion: 1, occurredAt: ticket.createdAt.toISOString(), correlationId: requestId,
        payload: { ticketId: ticket.id, reporterId: session.userId } };
      await client.query("INSERT INTO tickets.outbox (id, ticket_id, aggregate_version, event_type, payload) VALUES ($1, $2, 1, 'ticket.created.v1', $3)", [eventId, ticket.id, JSON.stringify(event)]);
      await client.query("COMMIT");
      return res.status(201).json({ data: { ...ticket, attachments: [] }, requestId });
    } catch {
      await client.rollback();
      if (res.destroyed || res.writableEnded || res.headersSent) return;
      return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    } finally {
      client.release();
    }
  });
  app.get("/api/v1/tickets", async (req, res) => {
    const requestId = randomUUID();
    const error = (status: number, code: string, message: string) =>
      res.status(status).json({ error: { code, message }, requestId });
    if (!req.get("cookie")) return error(401, "UNAUTHENTICATED", "Session is invalid.");
    if (!dependencies) return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    const session = await authenticate(req.get("cookie") ?? "", dependencies.authUrl, dependencies.serviceToken);
    if (session.kind === "unavailable") return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    if (session.kind === "invalid") return error(401, "UNAUTHENTICATED", "Session is invalid.");
    const scope = req.query.scope ?? ({ REPORTER: "mine", SUPPORT_AGENT: "assigned", ADMIN: "all" }[session.role]);
    const allowed = { REPORTER: ["mine"], SUPPORT_AGENT: ["assigned", "available"], ADMIN: ["all"] };
    if (typeof scope !== "string" || !["mine", "assigned", "available", "all"].includes(scope)) return error(422, "VALIDATION_ERROR", "Invalid scope.");
    if (!allowed[session.role].includes(scope)) return error(403, "FORBIDDEN", "Permission denied.");
    const status = req.query.status;
    if (status !== undefined && (typeof status !== "string" || !["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED", "CANCELLED"].includes(status))) return error(422, "VALIDATION_ERROR", "Invalid status.");
    const sort = req.query.sort ?? "created_desc";
    if (sort !== "created_desc" && sort !== "created_asc") return error(422, "VALIDATION_ERROR", "Invalid sort.");
    const limitValue = req.query.limit ?? "20";
    if (typeof limitValue !== "string" || !/^[0-9]+$/.test(limitValue) || Number(limitValue) < 1 || Number(limitValue) > 50) return error(422, "VALIDATION_ERROR", "Invalid limit.");
    const limit = Number(limitValue);
    let cursorTime: string | null = null;
    let cursorId: string | null = null;
    if (req.query.cursor !== undefined) {
      try {
        if (typeof req.query.cursor !== "string" || req.query.cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(req.query.cursor)) throw new Error();
        const parsed: unknown = JSON.parse(Buffer.from(req.query.cursor, "base64url").toString("utf8"));
        if (!Array.isArray(parsed) || parsed.length !== 6 || parsed[0] !== scope || parsed[1] !== (status ?? null) ||
            parsed[2] !== sort || parsed[3] !== session.userId || typeof parsed[4] !== "string" ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(parsed[4]) ||
            !Number.isFinite(Date.parse(parsed[4])) ||
            new Date(parsed[4]).toISOString().slice(0, 19) !== parsed[4].slice(0, 19) ||
            typeof parsed[5] !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed[5])) throw new Error();
        cursorTime = parsed[4];
        cursorId = parsed[5];
      } catch {
        return error(422, "VALIDATION_ERROR", "Invalid cursor.");
      }
    }
    const condition = scope === "mine" ? "reporter_id = $1" : scope === "assigned" ? "assignee_id = $1" :
      scope === "available" ? "status = 'OPEN' AND assignee_id IS NULL" : "true";
    const direction = sort === "created_asc" ? "ASC" : "DESC";
    const operator = sort === "created_asc" ? ">" : "<";
    try {
      const result = await dependencies.database.query(`SELECT id, category_code AS category, title,
        reporter_urgency AS "reporterUrgency", effective_priority AS "effectivePriority", status,
        created_at AS "createdAt", to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTime"
        FROM tickets.support_tickets WHERE (${condition}) AND ($2::text IS NULL OR status = $2)
        AND ($3::timestamptz IS NULL OR (created_at, id) ${operator} ($3::timestamptz, $4::uuid))
        AND $1::uuid IS NOT NULL ORDER BY created_at ${direction}, id ${direction} LIMIT $5`,
        [session.userId, status ?? null, cursorTime, cursorId, limit + 1]);
      const more = result.rows.length > limit;
      const rows = result.rows.slice(0, limit);
      const last = rows.at(-1);
      const nextCursor = more && last ? Buffer.from(JSON.stringify([scope, status ?? null, sort, session.userId, last.cursorTime, last.id])).toString("base64url") : null;
      const items = rows.map(({ cursorTime: _cursorTime, ...item }) => item);
      return res.status(200).json({ data: { items, page: { nextCursor } }, requestId });
    } catch {
      return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    }
  });
  app.get("/api/v1/tickets/:ticketId", async (req, res) => {
    const requestId = randomUUID();
    const error = (status: number, code: string, message: string) =>
      res.status(status).json({ error: { code, message }, requestId });
    if (!req.get("cookie")) return error(401, "UNAUTHENTICATED", "Session is invalid.");
    if (!dependencies) return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    const session = await authenticate(req.get("cookie") ?? "", dependencies.authUrl, dependencies.serviceToken);
    if (session.kind === "unavailable") return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    if (session.kind === "invalid") return error(401, "UNAUTHENTICATED", "Session is invalid.");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.ticketId)) return error(404, "NOT_FOUND", "Ticket not found.");
    try {
      const result = await dependencies.database.query(`SELECT id, reporter_id AS "reporterId", assignee_id AS "assigneeId",
        category_code AS category, title, description, location, equipment,
        reporter_urgency AS "reporterUrgency", effective_priority AS "effectivePriority",
        status, version, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM tickets.support_tickets WHERE id = $1 AND
        ($2::text = 'ADMIN' OR ($2 = 'REPORTER' AND reporter_id = $3) OR ($2 = 'SUPPORT_AGENT' AND assignee_id = $3))`,
        [req.params.ticketId, session.role, session.userId]);
      if (!result.rowCount) return error(404, "NOT_FOUND", "Ticket not found.");
      const attachments = await dependencies.database.query(`SELECT id, ticket_id AS "ticketId", content_type AS "contentType",
        size_bytes AS "sizeBytes", uploaded_at AS "uploadedAt" FROM tickets.ticket_attachments
        WHERE ticket_id = $1 ORDER BY uploaded_at, id`, [req.params.ticketId]);
      return res.status(200).json({ data: { ...result.rows[0], attachments: attachments.rows }, requestId });
    } catch {
      return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    }
  });
  app.use(mutationRoutes(dependencies));
  app.use(attachmentRoutes(dependencies));
  app.use(internalRoutes(dependencies));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "PayloadTooLargeError")) {
      return res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Invalid request body." }, requestId: randomUUID() });
    }
    return res.status(503).json({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "Service unavailable." }, requestId: randomUUID() });
  });
  return app;
}
