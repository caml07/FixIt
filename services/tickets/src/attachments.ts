import { createHash, randomUUID } from "node:crypto";
import { addAbortListener } from "node:events";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import type { AppDependencies } from "./app.js";
import { attachmentKey } from "./attachment-storage.js";
import { readAttachmentUpload } from "./attachment-upload.js";
import { attachmentTypes, videoLimit, type AttachmentType } from "./attachment-media.js";
import { authenticate, authenticateMutation } from "./auth.js";
import { checkoutTicketsDatabase, isDatabaseRejection } from "./database.js";

const storageTimeoutMs = 3000;

function waitForStorage(operation: Promise<void>, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const listener = addAbortListener(signal, () => reject(signal.reason));
    void operation.then(resolve, reject).finally(() => listener[Symbol.dispose]());
  });
}

const extensions: Record<AttachmentType, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4"
};

const uploadErrors = {
  413: ["PAYLOAD_TOO_LARGE", "Attachment size limit exceeded."],
  415: ["UNSUPPORTED_MEDIA_TYPE", "Unsupported attachment media."],
  422: ["VALIDATION_ERROR", "Invalid attachment request."]
} as const;

export function attachmentRoutes(dependencies?: AppDependencies) {
  const router = Router();
  const ticketPath = "/api/v1/tickets/:ticketId/attachments";
  let pendingUploads = 0;
  router.post(ticketPath, async (req, res) => {
    const requestId = randomUUID();
    const error = (status: number, code: string, message: string) => {
      if (!req.complete) {
        const length = Number(req.get("content-length"));
        if (!Number.isSafeInteger(length) || length > 16 * 1024) {
          res.set("Connection", "close");
        } else {
          // Give Node a bounded interval to discard a small rejected body without cutting off its response.
          const deadline = setTimeout(() => { if (!req.complete) req.destroy(); }, 1000);
          deadline.unref();
          req.once("close", () => clearTimeout(deadline));
        }
      }
      return res.status(status).json({ error: { code, message }, requestId });
    };
    const unavailable = () => {
      if (!res.destroyed && !res.writableEnded && !res.headersSent) {
        return error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
      }
    };
    const cookie = req.get("cookie");
    if (!cookie) return error(401, "UNAUTHENTICATED", "Session is invalid.");
    if (!dependencies) return unavailable();
    const session = await authenticateMutation(req, dependencies);
    if (session.kind === "forbidden") return error(403, "FORBIDDEN", "Request verification failed.");
    if (session.kind === "unavailable") return unavailable();
    if (session.kind === "invalid") return error(401, "UNAUTHENTICATED", "Session is invalid.");
    if (session.role !== "REPORTER") return error(403, "FORBIDDEN", "Permission denied.");
    const { ticketId } = req.params;
    if (!attachmentKey.test(ticketId)) return error(404, "NOT_FOUND", "Ticket not found.");
    const storage = dependencies.attachmentStorage;
    if (!storage) return unavailable();
    if (pendingUploads >= 4) {
      res.set("Retry-After", "1");
      return error(429, "RATE_LIMITED", "Too many uploads in progress.");
    }
    pendingUploads++;
    let lateCleanup: Promise<void> | undefined;
    try {
      const upload = await readAttachmentUpload(req);
      if (upload.status !== 200) {
        const [code, message] = uploadErrors[upload.status];
        return error(upload.status, code, message);
      }
      if (res.destroyed) return;
      const checksum = createHash("sha256").update(upload.bytes).digest("hex");
      const key = randomUUID();
      const client = await checkoutTicketsDatabase(dependencies.database);
      let transaction = false;
      let stored = false;
      let commitAttempted = false;
      let compensate = false;
      const removeStored = async () => {
        try {
          await waitForStorage(storage.remove(key), AbortSignal.timeout(storageTimeoutMs));
        } catch {
          console.error("Attachment cleanup requires reconciliation", { requestId, key });
        }
      };
      function reportPartial(failure: unknown) {
        if (failure instanceof AggregateError) {
          console.error("Incomplete attachment requires reconciliation", { requestId, key });
        }
      }
      try {
        await client.query("BEGIN");
        transaction = true;
        const result = await client.query<{ status: string; version: number }>(
          "SELECT status, version FROM tickets.support_tickets WHERE id = $1 AND reporter_id = $2 FOR UPDATE",
          [ticketId, session.userId]);
        const ticket = result.rows[0];
        if (!ticket) return error(404, "NOT_FOUND", "Ticket not found.");
        if (ticket.status !== "OPEN" || ticket.version !== upload.version) {
          return error(409, "CONFLICT", "Ticket state or version changed.");
        }
        const usage = await client.query<{ count: number; videos: number; bytes: number }>(`
          SELECT count(*)::int AS count, count(*) FILTER (WHERE content_type = 'video/mp4')::int AS videos,
            COALESCE(sum(size_bytes), 0)::int AS bytes
          FROM tickets.ticket_attachments WHERE ticket_id = $1`, [ticketId]);
        const quota = usage.rows[0];
        if (quota.count >= 5 || (upload.contentType === "video/mp4" && quota.videos >= 2)) {
          return error(409, "CONFLICT", "Attachment count limit reached.");
        }
        if (quota.bytes + upload.bytes.length > 2 * videoLimit) return error(413, ...uploadErrors[413]);
        const signal = AbortSignal.any([client.signal, AbortSignal.timeout(storageTimeoutMs)]);
        signal.throwIfAborted();
        const write = storage.put(key, upload.bytes);
        try {
          await waitForStorage(write, signal);
        } catch (failure) {
          if (signal.aborted) {
            // The write can finish after the request. Only remove a file this write successfully created.
            console.warn("Attachment write interrupted; cleanup deferred", { requestId, key });
            lateCleanup = write.then(removeStored, reportPartial);
          }
          throw failure;
        }
        stored = true;
        await client.query(`INSERT INTO tickets.ticket_attachments
          (ticket_id, uploaded_by, storage_key, content_type, size_bytes, sha256_hex)
          VALUES ($1, $2, $3, $4, $5, $6)`,
          [ticketId, session.userId, key, upload.contentType, upload.bytes.length, checksum]);
        const updated = await client.query(`UPDATE tickets.support_tickets SET version = version + 1, updated_at = now()
          WHERE id = $1 RETURNING id, reporter_id AS "reporterId", assignee_id AS "assigneeId",
            category_code AS category, title, description, location, equipment,
            reporter_urgency AS "reporterUrgency", effective_priority AS "effectivePriority",
            status, version, created_at AS "createdAt", updated_at AS "updatedAt"`, [ticketId]);
        await client.query(`INSERT INTO tickets.ticket_timeline (ticket_id, actor_user_id, event_type, ticket_version)
          VALUES ($1, $2, 'ATTACHMENT_ADDED', $3)`, [ticketId, session.userId, updated.rows[0].version]);
        const attachments = await client.query(`SELECT id, ticket_id AS "ticketId", content_type AS "contentType",
          size_bytes AS "sizeBytes", uploaded_at AS "uploadedAt" FROM tickets.ticket_attachments
          WHERE ticket_id = $1 ORDER BY uploaded_at, id`, [ticketId]);
        commitAttempted = true;
        await client.query("COMMIT");
        transaction = false;
        return res.status(201).json({ data: { ...updated.rows[0], attachments: attachments.rows }, requestId });
      } catch (failure) {
        if (transaction && commitAttempted && !isDatabaseRejection(failure)) {
          console.error("Attachment commit outcome requires reconciliation", { requestId, key });
        } else {
          compensate = transaction && stored;
          if (!lateCleanup) reportPartial(failure);
        }
      } finally {
        if (transaction) await client.rollback();
        client.release();
      }
      if (compensate) await removeStored();
      return unavailable();
    } catch {
      return unavailable();
    } finally {
      if (lateCleanup) void lateCleanup.finally(() => { pendingUploads--; });
      else pendingUploads--;
    }
  });

  router.get("/api/v1/tickets/:ticketId/attachments/:attachmentId", async (req, res) => {
    const requestId = randomUUID();
    const error = (status: number, code: string, message: string) =>
      res.status(status).json({ error: { code, message }, requestId });
    const unavailable = () => error(503, "DEPENDENCY_UNAVAILABLE", "Service unavailable.");
    const notFound = () => error(404, "NOT_FOUND", "Attachment not found.");
    const cookie = req.get("cookie");
    if (!cookie) return error(401, "UNAUTHENTICATED", "Session is invalid.");
    if (!dependencies) return unavailable();
    const session = await authenticate(cookie, dependencies.authUrl, dependencies.serviceToken);
    if (session.kind === "unavailable") return unavailable();
    if (session.kind === "invalid") return error(401, "UNAUTHENTICATED", "Session is invalid.");
    const { ticketId, attachmentId } = req.params;
    if (!attachmentKey.test(ticketId) || !attachmentKey.test(attachmentId)) return notFound();
    try {
      const result = await dependencies.database.query<{ storage_key: string; content_type: AttachmentType; size_bytes: number }>(`
        SELECT a.storage_key, a.content_type, a.size_bytes
        FROM tickets.ticket_attachments AS a JOIN tickets.support_tickets AS t ON a.ticket_id = t.id
        WHERE t.id = $1 AND a.id = $2 AND ($3::text = 'ADMIN'
          OR ($3 = 'REPORTER' AND t.reporter_id = $4) OR ($3 = 'SUPPORT_AGENT' AND t.assignee_id = $4))`,
        [ticketId, attachmentId, session.role, session.userId]);
      const attachment = result.rows[0];
      if (!attachment) return notFound();
      if (!dependencies.attachmentStorage || !attachmentTypes.includes(attachment.content_type)) return unavailable();
      const stream = await dependencies.attachmentStorage.open(attachment.storage_key, attachment.size_bytes);
      res.set({
        "Content-Type": attachment.content_type,
        "Content-Disposition": `attachment; filename="evidence.${extensions[attachment.content_type]}"`,
        "Content-Length": String(attachment.size_bytes),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
      });
      await pipeline(stream, res);
    } catch {
      if (!res.headersSent && !res.destroyed) return unavailable();
    }
  });
  return router;
}
