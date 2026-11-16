import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import express, { type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client.ts";
import type { AuthDatabase } from "./db.ts";
import {
  clearSessionCookie, cleanPassword, csrfToken, equalsSecret, expiresAtHours,
  FULL_SECONDS, newSecret, passwordError, readSessionCookie, setSessionCookie,
  TEMPORARY_PASSWORD_HOURS, TEMPORARY_SECONDS, tokenHash,
} from "./security.ts";

type UserInfo = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  accountStatus: string;
};

type Options = {
  database: AuthDatabase;
  publicOrigin: string;
  csrfKey: string;
  serviceTokens: readonly [string, string];
};

const credentialOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const loginInput = z.strictObject({ email: z.email(), password: z.string().min(1) });
const activationInput = z.strictObject({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(15),
});
const createInput = z.strictObject({
  email: z.email(),
  displayName: z.string().trim().min(1).max(120),
  role: z.enum(["REPORTER", "SUPPORT_AGENT"]),
});
const introspectInput = z.strictObject({ sessionToken: z.string().min(1).max(256) });
const listInput = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});
const roles = ["REPORTER", "SUPPORT_AGENT"];

function publicUser(user: UserInfo) {
  return {
    id: user.id, email: user.email, displayName: user.displayName,
    role: user.role, accountStatus: user.accountStatus,
  };
}

function sendData(res: Response, data: unknown, status = 200) {
  return res.status(status).json({ data, requestId: res.locals.requestId });
}
function sendError(res: Response, status: number, code: string, message: string) {
  return res.status(status).json({ error: { code, message }, requestId: res.locals.requestId });
}
function isKnownUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function createAuthApp(options: Options) {
  const { database, publicOrigin, csrfKey, serviceTokens } = options;
  const app = express();
  app.disable("x-powered-by");
  // The API is reached through the private reverse proxy / Cloudflare Tunnel.
  // Do not trust arbitrary X-Forwarded-For; do not use wildcard CORS.
  app.use(helmet());
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    next();
  });
  app.use(express.json({ limit: "16kb" }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false,
    handler: (_req, res) => sendError(res, 429, "RATE_LIMITED", "Demasiados intentos."),
  });
  const adminLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false,
    handler: (_req, res) => sendError(res, 429, "RATE_LIMITED", "Demasiadas operaciones."),
  });

  const fakePasswordHash = argon2.hash(randomBytes(32).toString("base64url"), credentialOptions);
  function allowedOrigin(req: Request): boolean {
    const origin = req.get("Origin");
    return origin === publicOrigin && req.get("Sec-Fetch-Site") !== "cross-site";
  }

  async function sessionFor(req: Request) {
    const token = readSessionCookie(req.get("Cookie"));
    if (!token) return null;
    const hash = tokenHash(token);
    const found = await database.session.findUnique({
      where: { tokenHash: hash }, include: { user: true },
    });
    const now = Date.now();
    if (!found || found.revokedAt || found.expiresAt.getTime() <= now) return null;
    if (found.scope === "FULL" && found.user.accountStatus !== "ACTIVE") return null;
    if (found.scope === "PASSWORD_CHANGE_ONLY" &&
      (found.user.accountStatus !== "PENDING_PASSWORD_CHANGE" ||
      !found.user.temporaryExpiresAt || found.user.temporaryExpiresAt.getTime() <= now)) {
      return null;
    }
    if (found.scope !== "FULL" && found.scope !== "PASSWORD_CHANGE_ONLY") return null;
    return found;
  }
  type Session = NonNullable<Awaited<ReturnType<typeof sessionFor>>>;

  async function signedIn(req: Request, res: Response): Promise<Session | null> {
    const session = await sessionFor(req);
    if (!session) sendError(res, 401, "UNAUTHENTICATED", "Sesión inválida o expirada.");
    return session;
  }
  async function admin(req: Request, res: Response): Promise<Session | null> {
    const session = await signedIn(req, res);
    if (!session) return null;
    if (session.scope !== "FULL" || session.user.role !== "ADMIN") {
      sendError(res, 403, "FORBIDDEN", "Se requiere una cuenta administradora activa.");
      return null;
    }
    return session;
  }
  function mutatingRequest(req: Request, res: Response, session: Session): boolean {
    if (!allowedOrigin(req)) {
      sendError(res, 403, "ORIGIN_DENIED", "Origen no permitido.");
      return false;
    }
    const supplied = req.get("X-CSRF-Token") ?? "";
    if (supplied.length !== 43 || !equalsSecret(supplied, csrfToken(session.tokenHash, csrfKey))) {
      sendError(res, 403, "CSRF_DENIED", "Token CSRF inválido.");
      return false;
    }
    return true;
  }
  function targetId(req: Request, res: Response): string | null {
    const id = z.uuid().safeParse(req.params.userId);
    if (!id.success) {
      sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.");
      return null;
    }
    return id.data;
  }

  async function hashPassword(password: string) {
    return argon2.hash(cleanPassword(password), credentialOptions);
  }

  app.get("/health", (_req, res) => sendData(res, { status: "ok" }));

  app.post("/api/v1/auth/login", loginLimiter, async (req, res) => {
    if (!allowedOrigin(req)) return sendError(res, 403, "ORIGIN_DENIED", "Origen no permitido.");
    const parsed = loginInput.safeParse(req.body);
    if (!parsed.success) return sendError(res, 422, "INVALID_INPUT", "Credenciales inválidas.");
    const email = parsed.data.email.trim().toLowerCase();
    const user = await database.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
    if (!user) {
      await argon2.verify(await fakePasswordHash, parsed.data.password);
      return sendError(res, 401, "INVALID_CREDENTIALS", "Credenciales incorrectas.");
    }
    const valid = await argon2.verify(user.passwordHash, cleanPassword(parsed.data.password));
    if (!valid || user.accountStatus === "DISABLED" ||
      (user.accountStatus === "PENDING_PASSWORD_CHANGE" &&
        (!user.temporaryExpiresAt || user.temporaryExpiresAt.getTime() <= Date.now()))) {
      return sendError(res, 401, "INVALID_CREDENTIALS", "Credenciales incorrectas.");
    }
    if (user.accountStatus !== "ACTIVE" && user.accountStatus !== "PENDING_PASSWORD_CHANGE") {
      return sendError(res, 401, "INVALID_CREDENTIALS", "Credenciales incorrectas.");
    }
    const limited = user.accountStatus === "PENDING_PASSWORD_CHANGE";
    const lifetime = limited ? TEMPORARY_SECONDS : FULL_SECONDS;
    const token = newSecret();
    await database.session.create({
      data: {
        tokenHash: tokenHash(token), userId: user.id,
        scope: limited ? "PASSWORD_CHANGE_ONLY" : "FULL",
        expiresAt: new Date(Date.now() + lifetime * 1000),
      },
    });
    res.setHeader("Set-Cookie", setSessionCookie(token, lifetime));
    res.setHeader("Cache-Control", "no-store");
    return sendData(res, { user: publicUser(user), mustChangePassword: limited });
  });

  app.get("/api/v1/auth/csrf", async (req, res) => {
    const session = await signedIn(req, res);
    if (!session) return;
    res.setHeader("Cache-Control", "no-store");
    return sendData(res, { csrfToken: csrfToken(session.tokenHash, csrfKey) });
  });

  app.get("/api/v1/auth/me", async (req, res) => {
    const session = await signedIn(req, res);
    if (!session) return;
    res.setHeader("Cache-Control", "no-store");
    return sendData(res, {
      user: publicUser(session.user),
      mustChangePassword: session.scope === "PASSWORD_CHANGE_ONLY",
    });
  });

  app.post("/api/v1/auth/logout", async (req, res) => {
    const session = await signedIn(req, res);
    if (!session || !mutatingRequest(req, res, session)) return;
    await database.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.status(204).end();
  });

  app.post("/api/v1/auth/password/activate", async (req, res) => {
    const session = await signedIn(req, res);
    if (!session || !mutatingRequest(req, res, session)) return;
    if (session.scope !== "PASSWORD_CHANGE_ONLY") {
      return sendError(res, 403, "FORBIDDEN", "Se requiere una sesión de activación.");
    }
    const parsed = activationInput.safeParse(req.body);
    if (!parsed.success) return sendError(res, 422, "INVALID_INPUT", "Contraseña inválida.");
    const reason = passwordError(parsed.data.newPassword);
    if (reason) return sendError(res, 422, "WEAK_PASSWORD", reason);
    const currentOk = await argon2.verify(session.user.passwordHash, cleanPassword(parsed.data.currentPassword));
    if (!currentOk || cleanPassword(parsed.data.newPassword) === cleanPassword(parsed.data.currentPassword)) {
      return sendError(res, 403, "FORBIDDEN", "La contraseña nueva debe ser diferente.");
    }
    const hashed = await hashPassword(parsed.data.newPassword);
    const now = new Date();
    const updated = await database.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: {
          id: session.user.id, accountStatus: "PENDING_PASSWORD_CHANGE",
          passwordHash: session.user.passwordHash, temporaryExpiresAt: { gt: now },
        },
        data: { accountStatus: "ACTIVE", passwordHash: hashed, temporaryExpiresAt: null, updatedAt: now },
      });
      if (result.count !== 1) return false;
      await tx.session.updateMany({ where: { userId: session.user.id, revokedAt: null }, data: { revokedAt: now } });
      await tx.accountAudit.create({
        data: { subjectUserId: session.user.id, actorUserId: session.user.id, action: "PASSWORD_ACTIVATED" },
      });
      return true;
    });
    if (!updated) return sendError(res, 409, "STATE_CHANGED", "La cuenta cambió durante la activación.");
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.status(204).end();
  });

  app.use("/api/v1/admin", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  }, adminLimiter);

  app.get("/api/v1/admin/users", async (req, res) => {
    const session = await admin(req, res);
    if (!session) return;
    const parsed = listInput.safeParse(req.query);
    if (!parsed.success) return sendError(res, 422, "INVALID_INPUT", "Paginación inválida.");
    const { limit, cursor } = parsed.data;
    const users = await database.user.findMany({
      take: limit + 1, orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = users.length > limit;
    const items = users.slice(0, limit);
    return sendData(res, {
      items: items.map(publicUser),
      page: { nextCursor: hasMore ? items[items.length - 1].id : null },
    });
  });

  app.post("/api/v1/admin/users", async (req, res) => {
    const session = await admin(req, res);
    if (!session || !mutatingRequest(req, res, session)) return;
    const parsed = createInput.safeParse(req.body);
    if (!parsed.success) return sendError(res, 422, "INVALID_INPUT", "Datos de cuenta inválidos.");
    const temporaryPassword = newSecret();
    const hash = await hashPassword(temporaryPassword);
    const normalizedEmail = parsed.data.email.trim().toLowerCase();
    try {
      const user = await database.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: normalizedEmail, displayName: parsed.data.displayName, role: parsed.data.role,
            accountStatus: "PENDING_PASSWORD_CHANGE", passwordHash: hash,
            temporaryExpiresAt: expiresAtHours(TEMPORARY_PASSWORD_HOURS),
            createdById: session.user.id,
          },
        });
        await tx.accountAudit.create({
          data: { subjectUserId: created.id, actorUserId: session.user.id, action: "CREATED" },
        });
        return created;
      });
      res.setHeader("Cache-Control", "no-store");
      return sendData(res, { user: publicUser(user), temporaryPassword }, 201);
    } catch (error) {
      if (isKnownUniqueError(error)) return sendError(res, 409, "DUPLICATE_EMAIL", "Cuenta ya registrada.");
      throw error;
    }
  });

  app.post("/api/v1/admin/users/:userId/reset-password", async (req, res) => {
    const session = await admin(req, res);
    if (!session || !mutatingRequest(req, res, session)) return;
    const id = targetId(req, res);
    if (!id) return;
    const target = await database.user.findUnique({ where: { id } });
    if (!target) return sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.");
    if (target.role === "ADMIN") return sendError(res, 403, "FORBIDDEN", "Admin inicial protegido.");
    if (target.accountStatus === "DISABLED") return sendError(res, 409, "DISABLED", "Primero debe reactivar la cuenta.");
    const temporaryPassword = newSecret();
    const hash = await hashPassword(temporaryPassword);
    const changed = await database.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id, role: { in: roles }, accountStatus: { in: ["ACTIVE", "PENDING_PASSWORD_CHANGE"] }, passwordHash: target.passwordHash },
        data: {
          passwordHash: hash, accountStatus: "PENDING_PASSWORD_CHANGE",
          temporaryExpiresAt: expiresAtHours(TEMPORARY_PASSWORD_HOURS), updatedAt: new Date(),
        },
      });
      if (result.count !== 1) return false;
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.accountAudit.create({ data: { subjectUserId: id, actorUserId: session.user.id, action: "PASSWORD_RESET" } });
      return true;
    });
    if (!changed) return sendError(res, 409, "STATE_CHANGED", "La cuenta cambió.");
    res.setHeader("Cache-Control", "no-store");
    return sendData(res, { temporaryPassword });
  });

  app.post("/api/v1/admin/users/:userId/disable", async (req, res) => {
    const session = await admin(req, res);
    if (!session || !mutatingRequest(req, res, session)) return;
    const id = targetId(req, res);
    if (!id) return;
    const target = await database.user.findUnique({ where: { id } });
    if (!target) return sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.");
    if (target.role === "ADMIN") return sendError(res, 403, "FORBIDDEN", "Admin inicial protegido.");
    if (target.accountStatus === "DISABLED") return res.status(204).end();
    const changed = await database.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id, role: { in: roles }, accountStatus: { in: ["ACTIVE", "PENDING_PASSWORD_CHANGE"] } },
        data: { accountStatus: "DISABLED", temporaryExpiresAt: null, updatedAt: new Date() },
      });
      if (result.count !== 1) return false;
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.accountAudit.create({
        data: { subjectUserId: id, actorUserId: session.user.id, action: "DISABLED" },
      });
      return true;
    });
    if (!changed) return sendError(res, 409, "STATE_CHANGED", "La cuenta cambió.");
    res.status(204).end();
  });

  app.post("/api/v1/admin/users/:userId/reactivate", async (req, res) => {
    const session = await admin(req, res);
    if (!session || !mutatingRequest(req, res, session)) return;
    const id = targetId(req, res);
    if (!id) return;
    const target = await database.user.findUnique({ where: { id } });
    if (!target) return sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.");
    if (target.role === "ADMIN") return sendError(res, 403, "FORBIDDEN", "Admin inicial protegido.");
    if (target.accountStatus !== "DISABLED") return sendError(res, 409, "STATE_CHANGED", "La cuenta no está desactivada.");
    const temporaryPassword = newSecret();
    const hash = await hashPassword(temporaryPassword);
    const changed = await database.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: { id, role: { in: roles }, accountStatus: "DISABLED" },
        data: {
          passwordHash: hash, accountStatus: "PENDING_PASSWORD_CHANGE",
          temporaryExpiresAt: expiresAtHours(TEMPORARY_PASSWORD_HOURS), updatedAt: new Date(),
        },
      });
      if (result.count !== 1) return false;
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.accountAudit.create({
        data: { subjectUserId: id, actorUserId: session.user.id, action: "REACTIVATED" },
      });
      return true;
    });
    if (!changed) return sendError(res, 409, "STATE_CHANGED", "La cuenta cambió.");
    const user = await database.user.findUniqueOrThrow({ where: { id } });
    res.setHeader("Cache-Control", "no-store");
    return sendData(res, { user: publicUser(user), temporaryPassword });
  });

  app.post("/internal/v1/sessions/introspect", async (req, res) => {
    const bearer = req.get("Authorization") ?? "";
    const credential = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
    if (!serviceTokens.some((expected) => equalsSecret(credential, expected))) {
      return sendError(res, 401, "UNAUTHENTICATED", "Credencial interna inválida.");
    }
    const parsed = introspectInput.safeParse(req.body);
    if (!parsed.success) return sendError(res, 422, "INVALID_INPUT", "Formato de sesión inválido.");
    const { sessionToken } = parsed.data;
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) return sendData(res, { active: false });
    const found = await database.session.findUnique({
      where: { tokenHash: tokenHash(sessionToken) }, include: { user: true },
    });
    if (!found || found.revokedAt || found.expiresAt.getTime() <= Date.now() ||
        found.scope !== "FULL" || found.user.accountStatus !== "ACTIVE") {
      return sendData(res, { active: false });
    }
    return sendData(res, {
      active: true, subject: { userId: found.user.id, role: found.user.role },
      expiresAt: found.expiresAt.toISOString(),
    });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    // Never write request bodies, cookies or bearer credentials into logs.
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "PayloadTooLargeError")) {
      return sendError(res, 422, "INVALID_INPUT", "Solicitud JSON inválida.");
    }
    console.error("Auth request failed:", error instanceof Error ? error.name : "unknown");
    return sendError(res, 503, "SERVICE_UNAVAILABLE", "Servicio no disponible temporalmente.");
  });

  return app;
}
