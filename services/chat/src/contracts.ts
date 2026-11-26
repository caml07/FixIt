import { z } from "zod";

export const uuid = z.uuid();
export const status = z.enum([
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
  "CANCELLED",
]);
export const role = z.enum(["REPORTER", "SUPPORT_AGENT", "ADMIN"]);
export const subject = z.object({ userId: uuid, role });
export const session = z.discriminatedUnion("active", [
  z.object({ active: z.literal(false) }),
  z.object({ active: z.literal(true), subject, expiresAt: z.iso.datetime() }),
]);
export const permission = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(false), code: z.string().optional() }),
  z.object({
    allowed: z.literal(true),
    actorId: uuid,
    ticketVersion: z.number().int().positive(),
    ticketStatus: status,
  }),
]);
export const audience = z.object({
  reporterId: uuid,
  assigneeId: uuid.nullable(),
  status,
  version: z.number().int().positive(),
});
export const joinInput = z.strictObject({ ticketId: uuid });
export const sendInput = z.strictObject({
  ticketId: uuid,
  clientMessageId: uuid,
  body: z
    .string()
    .refine((v) => v.trim().length > 0 && Buffer.byteLength(v, "utf8") <= 2048),
});
export const message = z.strictObject({
  id: uuid,
  ticketId: uuid,
  senderId: uuid,
  clientMessageId: uuid,
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type Message = z.infer<typeof message>;
export type Subject = z.infer<typeof subject>;
export type Action = "chat.read" | "chat.write" | "chat.subscribe";
export const cursor = z.strictObject({
  ticketId: uuid,
  createdAt: z.iso.datetime(),
  id: uuid,
});

export const errors = {
  UNAUTHORIZED: { status: 401, message: "Sesion no valida" },
  FORBIDDEN: { status: 403, message: "Operacion no permitida" },
  NOT_FOUND: { status: 404, message: "Ticket no encontrado" },
  CONFLICT: { status: 409, message: "Conflicto de estado o mensaje" },
  VALIDATION_ERROR: { status: 422, message: "Entrada invalida" },
  RATE_LIMITED: { status: 429, message: "Limite de solicitudes alcanzado" },
  DEPENDENCY_UNAVAILABLE: {
    status: 503,
    message: "Servicio temporalmente no disponible",
  },
};
export type ErrorCode = keyof typeof errors;
export class ChatError extends Error {
  constructor(readonly code: ErrorCode) {
    super(errors[code].message);
  }
}
export function publicError(error: unknown) {
  const code =
    error instanceof ChatError
      ? error.code
      : error instanceof z.ZodError
        ? "VALIDATION_ERROR"
        : "DEPENDENCY_UNAVAILABLE";
  return { code, message: errors[code].message };
}
export function sessionCookie(header: string | undefined) {
  const values = (header ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.startsWith("__Host-fixit_session="));
  const token = values[0]?.slice("__Host-fixit_session=".length);
  if (values.length !== 1 || !token || !/^[A-Za-z0-9_-]{1,512}$/.test(token))
    throw new ChatError("UNAUTHORIZED");
  return token;
}
