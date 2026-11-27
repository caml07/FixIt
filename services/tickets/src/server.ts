import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openTicketsDatabase } from "./database.js";

export function manageShutdown(server: Server, pool?: { end(): Promise<void> }, timeoutMs = 5000) {
  let shutdownPromise: Promise<void> | undefined;
  return function shutdown(): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = new Promise((resolve, reject) => {
      let timedOut = false;
      let poolClosing: Promise<void> | undefined;
      const closePool = () => {
        poolClosing ??= Promise.resolve().then(() => pool?.end());
        return poolClosing;
      };
      const timer = setTimeout(() => {
        timedOut = true;
        server.closeAllConnections();
        void closePool().catch(() => {});
        reject(new Error("Shutdown timed out"));
      }, timeoutMs);
      server.close((error) => {
        if (timedOut) return;
        if (error) {
          clearTimeout(timer);
          reject(error);
          return;
        }
        closePool().then(() => {
          clearTimeout(timer);
          resolve();
        }, (poolError: unknown) => {
          clearTimeout(timer);
          reject(poolError);
        });
      });
      server.closeIdleConnections();
    });
    return shutdownPromise;
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { port, host } = loadConfig();
  const databaseUrl = process.env.TICKETS_DATABASE_URL;
  const authUrl = process.env.AUTH_INTERNAL_URL;
  const serviceToken = process.env.TICKETS_AUTH_SERVICE_TOKEN;
  const configuredChatToken = process.env.TICKETS_CHAT_SERVICE_TOKEN;
  const chatServiceToken = configuredChatToken && configuredChatToken.length >= 32 ? configuredChatToken : undefined;
  const database = databaseUrl && authUrl && serviceToken ? openTicketsDatabase(databaseUrl) : undefined;
  const dependencies = database && authUrl && serviceToken ? { database, authUrl, serviceToken, chatServiceToken } : undefined;
  const server = createServer(createApp(() => false, dependencies));
  const shutdown = manageShutdown(server, database);
  server.listen(port, host);
  function onSignal() {
    void shutdown().catch(() => {
      process.exitCode = 1;
      process.exit(1);
    });
  }
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}
