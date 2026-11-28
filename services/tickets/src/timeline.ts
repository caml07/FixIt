import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { AppDependencies } from "./app.js";
import { authenticate } from "./auth.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCursor(cursor: string, ticketId: string): number | undefined {
  if (cursor.length > 128 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(value) && value.length === 2 && value[0] === ticketId &&
        Number.isInteger(value[1]) && value[1] >= 1 && value[1] <= 2147483647 &&
        Buffer.from(JSON.stringify(value)).toString("base64url") === cursor) return value[1];
  } catch {
    return;
  }
}

export function timelineRoutes(dependencies?: AppDependencies) {
  const router = Router();
  router.get("/api/v1/tickets/:ticketId/events", async (req, res) => {
    const requestId = randomUUID();
    const error = (status: number, code: string, message: string) =>
      res.status(status).json({ error: { code, message }, requestId });
    const unavailable = () => error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    const notFound = () => error(404, "NOT_FOUND", "Ticket not found.");
    res.set("Cache-Control", "no-store");
    const cookie = req.get("cookie");
    if (!cookie) return error(401, "UNAUTHENTICATED", "Session is invalid.");
    if (!dependencies) return unavailable();
    const session = await authenticate(cookie, dependencies.authUrl, dependencies.serviceToken);
    if (session.kind === "invalid") return error(401, "UNAUTHENTICATED", "Session is invalid.");
    if (session.kind === "unavailable") return unavailable();
    const ticketId = req.params.ticketId.toLowerCase();
    if (!uuid.test(ticketId)) return notFound();

    const queryStart = req.originalUrl.indexOf("?");
    const query = new URLSearchParams(queryStart < 0 ? "" : req.originalUrl.slice(queryStart + 1));
    const limits = query.getAll("limit");
    const cursors = query.getAll("cursor");
    const limitText = limits[0] ?? "50";
    const limit = Number(limitText);
    const version = cursors.length === 1 ? parseCursor(cursors[0], ticketId) : undefined;
    const invalid = limits.length > 1 || !/^[0-9]+$/.test(limitText) || limit < 1 || limit > 100 ||
      cursors.length > 1 || (cursors.length === 1 && version === undefined) ||
      [...query.keys()].some((key) => key.startsWith("limit[") || key.startsWith("cursor["));
    try {
      const result = await dependencies.database.query(`
        SELECT ( $4::int IS NULL OR EXISTS (
          SELECT 1 FROM tickets.ticket_timeline anchor WHERE anchor.ticket_id = t.id AND anchor.ticket_version = $4
        )) AS "validCursor", page.*
        FROM tickets.support_tickets t
        LEFT JOIN LATERAL (
          SELECT e.id, e.ticket_id AS "ticketId", e.actor_user_id AS "actorUserId", e.event_type AS "eventType",
            e.ticket_version AS "ticketVersion", e.from_status AS "fromStatus", e.to_status AS "toStatus",
            e.from_urgency AS "fromUrgency", e.to_urgency AS "toUrgency", e.from_priority AS "fromPriority",
            e.to_priority AS "toPriority", e.reason, e.recorded_at AS "recordedAt"
          FROM tickets.ticket_timeline e WHERE e.ticket_id = t.id AND e.ticket_version > COALESCE($4::int, 0)
          ORDER BY e.ticket_version LIMIT $5
        ) page ON true
        WHERE t.id = $1 AND ($2::text = 'ADMIN' OR ($2 = 'REPORTER' AND t.reporter_id = $3)
          OR ($2 = 'SUPPORT_AGENT' AND t.assignee_id = $3))
        ORDER BY page."ticketVersion"`, [ticketId, session.role, session.userId, version ?? null, invalid ? 0 : limit + 1]);
      if (!result.rowCount) return notFound();
      if (invalid || !result.rows[0].validCursor) return error(422, "VALIDATION_ERROR", "Invalid timeline pagination.");
      const items = result.rows.filter((row) => row.id !== null).slice(0, limit)
        .map(({ validCursor: _validCursor, ...event }) => event);
      const nextCursor = result.rows.length > limit
        ? Buffer.from(JSON.stringify([ticketId, items.at(-1)?.ticketVersion])).toString("base64url") : null;
      return res.status(200).json({ data: { items, nextCursor }, requestId });
    } catch {
      return unavailable();
    }
  });
  return router;
}
