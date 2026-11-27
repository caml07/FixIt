import express from "express";
import { randomUUID } from "node:crypto";

export function createApp(isDraining: () => boolean = () => false) {
  const app = express();
  app.get("/health", (_req, res) => {
    if (isDraining()) {
      res.status(503).json({ error: { code: "SERVICE_UNAVAILABLE", message: "Service is shutting down." }, requestId: randomUUID() });
      return;
    }
    res.status(200).json({ data: { status: "ok" }, requestId: randomUUID() });
  });
  return app;
}
