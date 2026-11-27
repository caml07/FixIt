export interface OutboxRow {
  id: string;
  ticket_id: string;
  aggregate_version: number;
  event_type: string;
  payload: unknown;
}

export interface OutboxMessage {
  id: string;
  subject: string;
  body: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses = new Set(["OPEN", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED", "CANCELLED"]);

function exactFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
}

function isId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

export function outboxMessage(row: OutboxRow): OutboxMessage | undefined {
  const event = row.payload;
  if (!exactFields(event, ["eventId", "type", "schemaVersion", "aggregateId", "aggregateVersion", "occurredAt", "correlationId", "payload"]) ||
      event.eventId !== row.id || event.type !== row.event_type || event.schemaVersion !== 1 ||
      event.aggregateId !== row.ticket_id || event.aggregateVersion !== row.aggregate_version ||
      !isId(event.correlationId) || typeof event.occurredAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(event.occurredAt) ||
      !Number.isFinite(Date.parse(event.occurredAt))) return;

  const payload = event.payload;
  switch (row.event_type) {
    case "ticket.created.v1":
      if (row.aggregate_version !== 1 || !exactFields(payload, ["ticketId", "reporterId"]) || !isId(payload.reporterId)) return;
      break;
    case "ticket.claimed.v1":
      if (!exactFields(payload, ["ticketId", "assigneeId"]) || !isId(payload.assigneeId)) return;
      break;
    case "ticket.status-changed.v1":
      if (!exactFields(payload, ["ticketId", "from", "to"]) ||
          typeof payload.from !== "string" || !statuses.has(payload.from) ||
          typeof payload.to !== "string" || !statuses.has(payload.to)) return;
      break;
    case "ticket.reassigned.v1":
      if (!exactFields(payload, ["ticketId", "previousAssigneeId", "assigneeId"]) ||
          !isId(payload.previousAssigneeId) || !isId(payload.assigneeId)) return;
      break;
    default:
      return;
  }
  if (payload.ticketId !== row.ticket_id) return;
  return { id: row.id, subject: `fixit.${row.event_type}`, body: JSON.stringify(event) };
}
