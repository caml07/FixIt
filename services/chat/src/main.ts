import { z } from "zod";
import { startChat } from "./server.js";

const env = z
  .object({
    MONGO_URI: z.string().startsWith("mongodb://"),
    AUTH_URL: z.url(),
    TICKETS_URL: z.url(),
    CHAT_SERVICE_TOKEN: z.string().min(16),
    PUBLIC_ORIGIN: z.url(),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    CHAT_SEND_LIMIT: z.coerce.number().int().positive().default(30),
    CHAT_READ_LIMIT: z.coerce.number().int().positive().default(120),
    INTERNAL_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  })
  .safeParse(process.env);
if (!env.success) {
  process.stderr.write("Chat: configuracion invalida\n");
  process.exit(1);
}
try {
  const value = env.data;
  const chat = await startChat({
    mongoUri: value.MONGO_URI,
    authUrl: value.AUTH_URL,
    ticketsUrl: value.TICKETS_URL,
    serviceToken: value.CHAT_SERVICE_TOKEN,
    origin: new URL(value.PUBLIC_ORIGIN).origin,
    port: value.PORT,
    host: "0.0.0.0",
    sendLimit: value.CHAT_SEND_LIMIT,
    readLimit: value.CHAT_READ_LIMIT,
    timeoutMs: value.INTERNAL_TIMEOUT_MS,
  });
  process.stdout.write(
    `${JSON.stringify({ event: "chat.started", port: value.PORT })}\n`,
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      void chat.close().catch(() => {
        process.exitCode = 1;
      });
    });
} catch {
  process.stderr.write(
    "Chat: fallo de arranque, comprobar configuracion y dependencias\n",
  );
  process.exitCode = 1;
}
