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
  FULL_SECONDS, IDLE_SECONDS, newSecret, passwordError, readSessionCookie, setSessionCookie,
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
  checkReadiness?: () => Promise<boolean>;
  rateLimits?: { login: number; admin: number; activation: number };
  passwordBlocklist?: ReadonlySet<string>;
  sessionTimeouts?: { full: number; idle: number; temporary: number };
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
const introspectInput = z.strictObject({
  sessionToken: z.string().min(1).max(256),
  csrfToken: z.string().max(256).optional(),
});
const listInput = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.uuid().optional(),
});
const roles = ["REPORTER", "SUPPORT_AGENT"];
const REQUEST_DEADLINE_MS = 5000;

function responseClosed(res: Response): boolean {
  return res.headersSent || res.destroyed;
}

function publicUser(user: UserInfo) {
  return {
    id: user.id, email: user.email, displayName: user.displayName,
    role: user.role, accountStatus: user.accountStatus,
  };
}

function sendData(res: Response, data: unknown, status = 200) {
  if (responseClosed(res)) return res;
  return res.status(status).json({ data, requestId: res.locals.requestId });
}
function sendError(res: Response, status: number, code: string, message: string) {
  if (responseClosed(res)) return res;
  return res.status(status).json({ error: { code, message }, requestId: res.locals.requestId });
}
function isKnownUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function createAuthApp(options: Options) {
  const { database, publicOrigin, csrfKey, serviceTokens } = options;
  const timeouts = options.sessionTimeouts ?? { full: FULL_SECONDS, idle: IDLE_SECONDS, temporary: TEMPORARY_SECONDS };
  const app = express();
  app.disable("x-powered-by");
  // The API is reached through the private reverse proxy / Cloudflare Tunnel.
  // Do not trust arbitrary X-Forwarded-For; do not use wildcard CORS.
  app.use(helmet());
  app.use((_req, res, next) => {
    res.locals.requestId = randomUUID();
    next();
  });
  app.use((req, res, next) => {
    if (req.path === "/health" || req.path === "/internal/v1/auth/ready") return next();
    const timer = setTimeout(() => {
      if (responseClosed(res)) return;
      res.setHeader("Cache-Control", "no-store");
      sendError(res, 503, "SERVICE_UNAVAILABLE", "Tiempo de espera agotado; el resultado puede ser incierto.");
    }, REQUEST_DEADLINE_MS);
    const cleanup = () => clearTimeout(timer);
    res.once("finish", cleanup);
    res.once("close", cleanup);
    next();
  });
  app.use(express.json({ limit: "16kb" }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: options.rateLimits?.login ?? 20, standardHeaders: "draft-8", legacyHeaders: false,
    handler: (_req, res) => sendError(res, 429, "RATE_LIMITED", "Demasiados intentos."),
  });
  const adminLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: options.rateLimits?.admin ?? 60, standardHeaders: "draft-8", legacyHeaders: false,
    handler: (_req, res) => sendError(res, 429, "RATE_LIMITED", "Demasiadas operaciones."),
  });
  const activationLimiter = rateLimit({
    windowMs: 15 * 60_000, limit: options.rateLimits?.activation ?? 20, standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: (_req, res) => String(res.locals.activationSession.user.id),
    handler: (_req, res) => sendError(res, 429, "RATE_LIMITED", "Demasiados intentos."),
  });

  const fakePasswordHash = argon2.hash(randomBytes(32).toString("base64url"), credentialOptions);
  function allowedOrigin(req: Request): boolean {
    const origin = req.get("Origin");
    return origin === publicOrigin && req.get("Sec-Fetch-Site") !== "cross-site";
  }

  async function activeSession(token: string, fullOnly = false) {
    const found = await database.session.findUnique({
      where: { tokenHash: tokenHash(token) }, include: { user: true },
    });
    const now = Date.now();
    const cutoff = new Date(now - timeouts.idle * 1000);
    if (!found || found.revokedAt || found.expiresAt.getTime() <= now) return null;
    if ((found.lastSeenAt ?? found.createdAt) <= cutoff) return null;
    if (fullOnly && found.scope !== "FULL") return null;
    if (found.scope === "FULL" && found.user.accountStatus !== "ACTIVE") return null;
    if (found.scope === "PASSWORD_CHANGE_ONLY" &&
      (found.user.accountStatus !== "PENDING_PASSWORD_CHANGE" ||
      !found.user.temporaryExpiresAt || found.user.temporaryExpiresAt.getTime() <= now)) {
      return null;
    }
    if (found.scope !== "FULL" && found.scope !== "PASSWORD_CHANGE_ONLY") return null;
    // Recheck the persisted deadline and revocation before renewing activity.
    const touched = await database.session.updateMany({
      where: { id: found.id, revokedAt: null, expiresAt: { gt: new Date(now) },
        OR: [{ lastSeenAt: { gt: cutoff } }, { lastSeenAt: null, createdAt: { gt: cutoff } }] },
      data: { lastSeenAt: new Date(now) },
    });
    if (touched.count !== 1) return null;
    return found;
  }
  async function sessionFor(req: Request) {
    const token = readSessionCookie(req.get("Cookie"));
    return token ? activeSession(token) : null;
  }
  type Session = NonNullable<Awaited<ReturnType<typeof sessionFor>>>;

  async function signedIn(req: Request, res: Response): Promise<Session | null> {
    const session = await sessionFor(req);
    if (responseClosed(res)) return null;
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
    if (responseClosed(res)) return;
    if (!user) {
      await argon2.verify(await fakePasswordHash, parsed.data.password);
      return sendError(res, 401, "INVALID_CREDENTIALS", "Credenciales incorrectas.");
    }
    const valid = await argon2.verify(user.passwordHash, cleanPassword(parsed.data.password));
    if (responseClosed(res)) return;
    if (!valid || user.accountStatus === "DISABLED" ||
      (user.accountStatus === "PENDING_PASSWORD_CHANGE" &&
        (!user.temporaryExpiresAt || user.temporaryExpiresAt.getTime() <= Date.now()))) {
      return sendError(res, 401, "INVALID_CREDENTIALS", "Credenciales incorrectas.");
    }
    if (user.accountStatus !== "ACTIVE" && user.accountStatus !== "PENDING_PASSWORD_CHANGE") {
      return sendError(res, 401, "INVALID_CREDENTIALS", "Credenciales incorrectas.");
    }
    const limited = user.accountStatus === "PENDING_PASSWORD_CHANGE";
    const lifetime = limited ? timeouts.temporary : timeouts.full;
    const token = newSecret();
    const created = await database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM auth.users WHERE id = ${user.id}::uuid FOR UPDATE`;
      const current = await tx.user.findUnique({ where: { id: user.id } });
      if (responseClosed(res)) return false;
      if (!current || current.passwordHash !== user.passwordHash ||
        current.accountStatus !== user.accountStatus ||
        (limited && (!current.temporaryExpiresAt || current.temporaryExpiresAt.getTime() <= Date.now()))) {
        return false;
      }
      await tx.session.create({
        data: {
          tokenHash: tokenHash(token), userId: user.id,
          scope: limited ? "PASSWORD_CHANGE_ONLY" : "FULL",
          expiresAt: new Date(Date.now() + lifetime * 1000), lastSeenAt: new Date(),
        },
      });
      return true;
    });
    if (responseClosed(res)) return;
    if (!created) return sendError(res, 401, "INVALID_CREDENTIALS", "Credenciales incorrectas.");
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
    if (responseClosed(res)) return;
    res.setHeader("Set-Cookie", clearSessionCookie());
    res.status(204).end();
  });

  app.post("/api/v1/auth/password/activate", async (req, res, next) => {
    const session = await signedIn(req, res);
    if (!session || !mutatingRequest(req, res, session)) return;
    if (session.scope !== "PASSWORD_CHANGE_ONLY") {
      return sendError(res, 403, "FORBIDDEN", "Se requiere una sesión de activación.");
    }
    res.locals.activationSession = session;
    next();
  }, activationLimiter, async (req, res) => {
    const session: Session = res.locals.activationSession;
    const parsed = activationInput.safeParse(req.body);
    if (!parsed.success) return sendError(res, 422, "INVALID_INPUT", "Contraseña inválida.");
    const reason = passwordError(parsed.data.newPassword, options.passwordBlocklist);
    if (reason) return sendError(res, 422, "WEAK_PASSWORD", reason);
    const currentOk = await argon2.verify(session.user.passwordHash, cleanPassword(parsed.data.currentPassword));
    if (!currentOk || cleanPassword(parsed.data.newPassword) === cleanPassword(parsed.data.currentPassword)) {
      return sendError(res, 403, "FORBIDDEN", "La contraseña nueva debe ser diferente.");
    }
    const hashed = await hashPassword(parsed.data.newPassword);
    if (responseClosed(res)) return;
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
    if (responseClosed(res)) return;
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
    if (responseClosed(res)) return;
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
      if (responseClosed(res)) return;
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
    if (responseClosed(res)) return;
    if (!target) return sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.");
    if (target.role === "ADMIN") return sendError(res, 403, "FORBIDDEN", "Admin inicial protegido.");
    if (target.accountStatus === "DISABLED") return sendError(res, 409, "DISABLED", "Primero debe reactivar la cuenta.");
    const temporaryPassword = newSecret();
    const hash = await hashPassword(temporaryPassword);
    if (responseClosed(res)) return;
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
    if (responseClosed(res)) return;
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
    if (responseClosed(res)) return;
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
    if (responseClosed(res)) return;
    if (!changed) return sendError(res, 409, "STATE_CHANGED", "La cuenta cambió.");
    res.status(204).end();
  });

  app.post("/api/v1/admin/users/:userId/reactivate", async (req, res) => {
    const session = await admin(req, res);
    if (!session || !mutatingRequest(req, res, session)) return;
    const id = targetId(req, res);
    if (!id) return;
    const target = await database.user.findUnique({ where: { id } });
    if (responseClosed(res)) return;
    if (!target) return sendError(res, 404, "NOT_FOUND", "Cuenta no encontrada.");
    if (target.role === "ADMIN") return sendError(res, 403, "FORBIDDEN", "Admin inicial protegido.");
    if (target.accountStatus !== "DISABLED") return sendError(res, 409, "STATE_CHANGED", "La cuenta no está desactivada.");
    const temporaryPassword = newSecret();
    const hash = await hashPassword(temporaryPassword);
    if (responseClosed(res)) return;
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
    if (responseClosed(res)) return;
    if (!changed) return sendError(res, 409, "STATE_CHANGED", "La cuenta cambió.");
    const user = await database.user.findUniqueOrThrow({ where: { id } });
    if (responseClosed(res)) return;
    res.setHeader("Cache-Control", "no-store");
    return sendData(res, { user: publicUser(user), temporaryPassword });
  });

  app.get("/internal/v1/auth/ready", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const bearer = req.get("Authorization") ?? "";
    const credential = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
    if (!serviceTokens.some((expected) => equalsSecret(credential, expected))) {
      return sendError(res, 401, "UNAUTHENTICATED", "Credencial interna inválida.");
    }
    if (!options.checkReadiness || !(await options.checkReadiness())) {
      return sendError(res, 503, "SERVICE_UNAVAILABLE", "Servicio no disponible temporalmente.");
    }
    return sendData(res, { status: "ready" });
  });

  app.post("/internal/v1/sessions/introspect", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const bearer = req.get("Authorization") ?? "";
    const credential = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
    if (!serviceTokens.some((expected) => equalsSecret(credential, expected))) {
      return sendError(res, 401, "UNAUTHENTICATED", "Credencial interna inválida.");
    }
    const parsed = introspectInput.safeParse(req.body);
    if (!parsed.success) return sendError(res, 422, "INVALID_INPUT", "Formato de sesión inválido.");
    const { sessionToken, csrfToken: suppliedCsrf } = parsed.data;
    const inactive = suppliedCsrf === undefined ? { active: false } : { active: false, csrfValid: false };
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionToken)) return sendData(res, inactive);
    const found = await activeSession(sessionToken, true);
    if (!found) {
      return sendData(res, inactive);
    }
    return sendData(res, {
      active: true, subject: { userId: found.user.id, role: found.user.role },
      expiresAt: found.expiresAt.toISOString(),
      ...(suppliedCsrf === undefined ? {} : {
        csrfValid: suppliedCsrf.length === 43 && equalsSecret(suppliedCsrf, csrfToken(found.tokenHash, csrfKey)),
      }),
    });
  });

  app.get("/internal/v1/users/:userId/agent-eligibility", async (req, res) => {
    const bearer = req.get("Authorization") ?? "";
    const credential = bearer.startsWith("Bearer ") ? bearer.slice(7) : "";
    if (!equalsSecret(credential, serviceTokens[0])) {
      if (equalsSecret(credential, serviceTokens[1])) {
        return sendError(res, 403, "FORBIDDEN", "Servicio no autorizado.");
      }
      return sendError(res, 401, "UNAUTHENTICATED", "Credencial interna inválida.");
    }
    res.setHeader("Cache-Control", "no-store");
    const id = z.uuid().safeParse(req.params.userId);
    if (!id.success) return sendData(res, { eligible: false });
    const user = await database.user.findUnique({
      where: { id: id.data }, select: { role: true, accountStatus: true },
    });
    return sendData(res, { eligible: user?.role === "SUPPORT_AGENT" && user.accountStatus === "ACTIVE" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    if (responseClosed(res)) return;
    // Never write request bodies, cookies or bearer credentials into logs.
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "PayloadTooLargeError")) {
      return sendError(res, 422, "INVALID_INPUT", "Solicitud JSON inválida.");
    }
    console.error("Auth request failed:", error instanceof Error ? error.name : "unknown");
    return sendError(res, 503, "SERVICE_UNAVAILABLE", "Servicio no disponible temporalmente.");
  });

  return app;
}
