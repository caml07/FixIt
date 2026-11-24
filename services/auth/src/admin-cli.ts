import "dotenv/config";
import argon2 from "argon2";
import { z } from "zod";
import { openAuthDatabase } from "./db.ts";
import { expiresAtHours, newSecret, TEMPORARY_PASSWORD_HOURS } from "./security.ts";

async function run() {
  const [command, value] = process.argv.slice(2);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("CLI requires a private interactive TTY; do not redirect output.");
  }
  if (command !== "bootstrap" && command !== "reset-admin") {
    throw new Error("Usage: admin-cli bootstrap <email> | admin-cli reset-admin");
  }
  if (command === "bootstrap" && !z.email().safeParse(value).success) {
    throw new Error("A valid initial Admin email is required.");
  }
  if (!process.env.AUTH_DATABASE_URL) throw new Error("AUTH_DATABASE_URL missing.");
  const db = openAuthDatabase(process.env.AUTH_DATABASE_URL);
  try {
    const temporaryPassword = newSecret();
    const passwordHash = await argon2.hash(temporaryPassword, {
      type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1,
    });
    await db.$transaction(async (tx) => {
      // One installer at a time; no static credentials nor second Admin.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(629417)`;
      const admins = await tx.user.findMany({ where: { role: "ADMIN" }, take: 2 });
      if (command === "bootstrap") {
        if (admins.length) throw new Error("Admin already provisioned. Use reset-admin.");
        const admin = await tx.user.create({
          data: {
            email: value!.toLowerCase(), displayName: "FixIt Administrator", role: "ADMIN",
            accountStatus: "PENDING_PASSWORD_CHANGE", passwordHash,
            temporaryExpiresAt: expiresAtHours(TEMPORARY_PASSWORD_HOURS),
          },
        });
        await tx.accountAudit.create({ data: { subjectUserId: admin.id, action: "BOOTSTRAPPED" } });
      } else {
        if (admins.length !== 1) throw new Error("Expected exactly one Admin account.");
        const existing = admins[0];
        await tx.user.update({
          where: { id: existing.id },
          data: {
            accountStatus: "PENDING_PASSWORD_CHANGE", passwordHash,
            temporaryExpiresAt: expiresAtHours(TEMPORARY_PASSWORD_HOURS), updatedAt: new Date(),
          },
        });
        await tx.session.updateMany({
          where: { userId: existing.id, revokedAt: null }, data: { revokedAt: new Date() },
        });
        await tx.accountAudit.create({
          data: { subjectUserId: existing.id, actorUserId: existing.id, action: "PASSWORD_RESET", reason: "manual local recovery" },
        });
      }
    });
    // Output only after the database committed. Never output via a service logger.
    process.stdout.write("Temporary password (shown once, expires in 72h): " + temporaryPassword + "\n");
  } finally {
    await db.$disconnect();
  }
}

run().catch((error: unknown) => {
  console.error("Admin maintenance aborted:", error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});
