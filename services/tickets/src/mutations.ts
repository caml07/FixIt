import { Router, type Request, type Response } from "express";
import express from "express";
import { randomUUID } from "node:crypto";
import type { AppDependencies } from "./app.js";
import { authenticate } from "./auth.js";

type Action = "edit" | "claim" | "status" | "priority";
type Body = Record<string, unknown>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const urgencies = ["LOW", "NORMAL", "HIGH"];
const priorities = ["P1_CRITICAL", "P2_HIGH", "P3_NORMAL", "P4_LOW"];
const statuses = ["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED", "CANCELLED"];

function validText(value: unknown, max: number, nonempty: boolean): value is string {
  return typeof value === "string" && Array.from(value).length <= max && (!nonempty || Boolean(value.trim()));
}

function validBody(action: Action, body: unknown): body is Body {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const input = Object.fromEntries(Object.entries(body));
  if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 1) return false;
  if (action === "edit") {
    const allowed = ["expectedVersion", "title", "description", "category", "reporterUrgency"];
    return Object.keys(input).every((key) => allowed.includes(key)) &&
      Object.keys(input).some((key) => key !== "expectedVersion") &&
      (!("title" in input) || validText(input.title, 160, true)) &&
      (!("description" in input) || validText(input.description, 5000, true)) &&
      (!("category" in input) || validText(input.category, 40, false)) &&
      (!("reporterUrgency" in input) || (typeof input.reporterUrgency === "string" && urgencies.includes(input.reporterUrgency)));
  }
  if (action === "status") {
    return Object.keys(input).every((key) => ["expectedVersion", "to", "reason"].includes(key)) &&
      typeof input.to === "string" && statuses.includes(input.to) &&
      (!("reason" in input) || validText(input.reason, 500, false));
  }
  return Object.keys(input).every((key) => ["expectedVersion", "priority", "reason"].includes(key)) &&
    typeof input.priority === "string" && priorities.includes(input.priority) &&
    (!("reason" in input) || validText(input.reason, 500, true));
}

export function mutationRoutes(dependencies?: AppDependencies) {
  const router = Router();
  async function handle(action: Action, req: Request, res: Response) {
    const requestId = randomUUID();
    const error = (status: number, code: string, message: string) =>
      res.status(status).json({ error: { code, message }, requestId });
    if (!req.get("cookie")) return error(401, "UNAUTHENTICATED", "Session is invalid.");
    if (!dependencies) return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    const session = await authenticate(req.get("cookie") ?? "", dependencies.authUrl, dependencies.serviceToken);
    if (session.kind === "invalid") return error(401, "UNAUTHENTICATED", "Session is invalid.");
    if (session.kind === "unavailable") return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    if ((action === "edit" && session.role !== "REPORTER") ||
        (action === "claim" && session.role !== "SUPPORT_AGENT") ||
        (action === "priority" && session.role === "REPORTER")) {
      return error(403, "FORBIDDEN", "Permission denied.");
    }
    const csrf = req.get("x-csrf-token");
    if (!dependencies.publicOrigin || req.get("origin") !== dependencies.publicOrigin ||
        req.get("sec-fetch-site") === "cross-site" || !csrf || !dependencies.verifyCsrf ||
        !(await dependencies.verifyCsrf(csrf, session.sessionToken).catch(() => false))) {
      return error(403, "FORBIDDEN", "Request verification failed.");
    }
    const ticketId = req.params.ticketId;
    if (typeof ticketId !== "string" || !uuid.test(ticketId)) return error(404, "NOT_FOUND", "Ticket not found.");
    const body: unknown = req.body;
    let input: Body = {};
    if (action !== "claim") {
      if (!validBody(action, body)) return error(422, "VALIDATION_ERROR", "Invalid request.");
      input = body;
    }
    const client = await dependencies.database.connect().catch(() => null);
    if (!client) return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    let discard = false;
    try {
      await client.query("BEGIN");
      const found = await client.query("SELECT * FROM tickets.support_tickets WHERE id = $1 FOR UPDATE", [ticketId]);
      if (!found.rowCount) {
        await client.query("ROLLBACK");
        return error(404, "NOT_FOUND", "Ticket not found.");
      }
      const old = found.rows[0];
      if (action === "edit" && old.reporter_id !== session.userId) {
        await client.query("ROLLBACK");
        return error(404, "NOT_FOUND", "Ticket not found.");
      }
      if (action === "priority" && session.role === "SUPPORT_AGENT" && old.assignee_id !== session.userId) {
        await client.query("ROLLBACK");
        return error(403, "FORBIDDEN", "Permission denied.");
      }
      if (action === "status" && ((session.role === "REPORTER" && old.reporter_id !== session.userId) ||
          (session.role === "SUPPORT_AGENT" && old.assignee_id !== session.userId))) {
        await client.query("ROLLBACK");
        return error(404, "NOT_FOUND", "Ticket not found.");
      }
      if ((action !== "claim" && old.version !== input.expectedVersion) ||
          (action === "edit" && old.status !== "OPEN") ||
          (action === "claim" && (old.status !== "OPEN" || old.assignee_id !== null)) ||
          (action === "priority" && ["CLOSED", "CANCELLED"].includes(old.status))) {
        await client.query("ROLLBACK");
        return error(409, "CONFLICT", "Ticket state or version changed.");
      }
      if (action === "priority" && old.effective_priority !== null &&
          (!validText(input.reason, 500, true))) {
        await client.query("ROLLBACK");
        return error(422, "VALIDATION_ERROR", "A reason is required.");
      }
      if (action === "status") {
        const transition = old.status + "->" + input.to;
        const permitted = session.role === "REPORTER" ? ["RESOLVED->CLOSED", "OPEN->CANCELLED"] :
          session.role === "SUPPORT_AGENT" ? ["ASSIGNED->IN_PROGRESS", "IN_PROGRESS->RESOLVED"] :
            ["ASSIGNED->IN_PROGRESS", "IN_PROGRESS->RESOLVED", "RESOLVED->CLOSED", "OPEN->CANCELLED"];
        if (session.role === "ADMIN" && !validText(input.reason, 500, true)) {
          await client.query("ROLLBACK");
          return error(422, "VALIDATION_ERROR", "A reason is required.");
        }
        if (!["ASSIGNED->IN_PROGRESS", "IN_PROGRESS->RESOLVED", "RESOLVED->CLOSED", "OPEN->CANCELLED"].includes(transition)) {
          await client.query("ROLLBACK");
          return error(409, "CONFLICT", "Invalid ticket transition.");
        }
        if (!permitted.includes(transition)) {
          await client.query("ROLLBACK");
          return error(403, "FORBIDDEN", "Permission denied.");
        }
        if (input.to === "IN_PROGRESS" && !old.effective_priority) {
          await client.query("ROLLBACK");
          return error(409, "CONFLICT", "Invalid ticket transition.");
        }
      }
      if (action === "edit" && "category" in input) {
        const category = await client.query("SELECT code FROM tickets.categories WHERE code = $1 AND is_active = true FOR SHARE", [input.category]);
        if (!category.rowCount) {
          await client.query("ROLLBACK");
          return error(422, "VALIDATION_ERROR", "Invalid category.");
        }
      }
      const result = await client.query(`UPDATE tickets.support_tickets SET
          title = $2, description = $3, category_code = $4, reporter_urgency = $5,
          assignee_id = $6, status = $7, effective_priority = $8,
          version = version + 1, updated_at = now()
        WHERE id = $1 AND ($9::boolean = false OR (status = 'OPEN' AND assignee_id IS NULL))
        RETURNING id, reporter_id AS "reporterId", assignee_id AS "assigneeId",
          category_code AS category, title, description, location, equipment,
          reporter_urgency AS "reporterUrgency", effective_priority AS "effectivePriority",
          status, version, created_at AS "createdAt", updated_at AS "updatedAt"`,
        [old.id, input.title ?? old.title, input.description ?? old.description, input.category ?? old.category_code,
          input.reporterUrgency ?? old.reporter_urgency, action === "claim" ? session.userId : old.assignee_id,
          action === "claim" ? "ASSIGNED" : action === "status" ? input.to : old.status,
          action === "priority" ? input.priority : old.effective_priority, action === "claim"]);
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return error(409, "CONFLICT", "Ticket state changed.");
      }
      const ticket = result.rows[0];
      const eventType = { edit: "EDITED", claim: "CLAIMED", status: "STATUS_CHANGED", priority: "PRIORITY_UPDATED" }[action];
      await client.query(`INSERT INTO tickets.ticket_timeline
        (ticket_id, actor_user_id, event_type, ticket_version, from_status, to_status,
         from_urgency, to_urgency, from_priority, to_priority, reason)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [ticket.id, session.userId, eventType, ticket.version,
          action === "claim" || action === "status" ? old.status : null,
          action === "claim" || action === "status" ? ticket.status : null,
          action === "edit" && "reporterUrgency" in input ? old.reporter_urgency : null,
          action === "edit" && "reporterUrgency" in input ? ticket.reporterUrgency : null,
          action === "priority" ? old.effective_priority : null,
          action === "priority" ? ticket.effectivePriority : null, input.reason ?? null]);
      if (action === "claim" || action === "status") {
        const eventId = randomUUID();
        const type = action === "claim" ? "ticket.claimed.v1" : "ticket.status-changed.v1";
        const payload = action === "claim" ? { ticketId: ticket.id, assigneeId: session.userId } :
          { ticketId: ticket.id, from: old.status, to: ticket.status };
        const event = { eventId, type, schemaVersion: 1, aggregateId: ticket.id,
          aggregateVersion: ticket.version, occurredAt: ticket.updatedAt.toISOString(), correlationId: requestId, payload };
        await client.query("INSERT INTO tickets.outbox (id, ticket_id, aggregate_version, event_type, payload) VALUES ($1,$2,$3,$4,$5)",
          [eventId, ticket.id, ticket.version, type, JSON.stringify(event)]);
      }
      const attachments = await client.query(`SELECT id, ticket_id AS "ticketId", content_type AS "contentType",
        size_bytes AS "sizeBytes", uploaded_at AS "uploadedAt" FROM tickets.ticket_attachments
        WHERE ticket_id = $1 ORDER BY uploaded_at, id`, [ticket.id]);
      await client.query("COMMIT");
      return res.status(200).json({ data: { ...ticket, attachments: attachments.rows }, requestId });
    } catch {
      await client.query("ROLLBACK").catch(() => { discard = true; });
      return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    } finally {
      client.release(discard);
    }
  }
  router.patch("/api/v1/tickets/:ticketId", express.json({ limit: "128kb" }), (req, res) => handle("edit", req, res));
  router.post("/api/v1/tickets/:ticketId/claim", (req, res) => handle("claim", req, res));
  router.patch("/api/v1/tickets/:ticketId/status", express.json({ limit: "128kb" }), (req, res) => handle("status", req, res));
  router.patch("/api/v1/tickets/:ticketId/priority", express.json({ limit: "128kb" }), (req, res) => handle("priority", req, res));
  return router;
}
