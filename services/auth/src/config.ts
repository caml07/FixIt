import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  AUTH_DATABASE_URL: z.string().min(1),
  AUTH_PUBLIC_ORIGIN: z.url(),
  AUTH_CSRF_KEY: z.string().min(32),
  AUTH_TICKETS_SERVICE_TOKEN: z.string().min(32),
  AUTH_CHAT_SERVICE_TOKEN: z.string().min(32),
  AUTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export function readAuthConfig() {
  const result = schema.safeParse(process.env);
  if (!result.success) throw new Error("Auth configuration missing or invalid.");
  const config = result.data;
  if (config.AUTH_TICKETS_SERVICE_TOKEN === config.AUTH_CHAT_SERVICE_TOKEN) {
    throw new Error("Distinct internal service credentials are required.");
  }
  return config;
}
