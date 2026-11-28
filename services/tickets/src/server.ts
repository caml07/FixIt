import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { createApp } from "./app.js";
import { loadConfig, loadOutboxConfig } from "./config.js";
import { openOutboxDatabase, openTicketsDatabase } from "./database.js";
import { FileAttachmentStorage } from "./attachment-storage.js";
import { createJetStreamPublisher } from "./jetstream-publisher.js";
import { startOutboxWorker } from "./outbox-worker.js";

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
  const { port, host, publicOrigin } = loadConfig();
  const outboxConfig = loadOutboxConfig();
  const databaseUrl = process.env.TICKETS_DATABASE_URL;
  const authUrl = process.env.AUTH_INTERNAL_URL;
  const serviceToken = process.env.TICKETS_AUTH_SERVICE_TOKEN;
  const configuredChatToken = process.env.TICKETS_CHAT_SERVICE_TOKEN;
  const chatServiceToken = configuredChatToken && configuredChatToken.length >= 32 ? configuredChatToken : undefined;
  const database = databaseUrl && authUrl && serviceToken ? openTicketsDatabase(databaseUrl) : undefined;
  const attachmentDirectory = process.env.TICKETS_ATTACHMENT_DIRECTORY;
  const attachmentStorage = attachmentDirectory ? new FileAttachmentStorage(attachmentDirectory) : undefined;
  const dependencies = database && authUrl && serviceToken ? { database, authUrl, serviceToken, publicOrigin, chatServiceToken, attachmentStorage } : undefined;
  const server = createServer(createApp(() => false, dependencies));
  const outboxPool = outboxConfig && databaseUrl ? openOutboxDatabase(databaseUrl) : undefined;
  const worker = outboxPool && outboxConfig ? startOutboxWorker(outboxPool, createJetStreamPublisher(outboxConfig)) : undefined;
  let outboxClosing: Promise<void> | undefined;
  function stopOutbox() {
    return outboxClosing ??= (async () => {
      try {
        await worker?.stop();
      } finally {
        await outboxPool?.end();
      }
    })();
  }
  const shutdown = manageShutdown(server, {
    async end() {
      await Promise.all([database?.end(), stopOutbox()]);
    }
  }, worker ? 8000 : 5000);
  server.listen(port, host);
  function onSignal() {
    void stopOutbox().catch(() => {});
    void shutdown().catch(() => {
      process.exitCode = 1;
      process.exit(1);
    });
  }
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
}
