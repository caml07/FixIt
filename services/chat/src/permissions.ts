import { z } from "zod";
import {
  type Action,
  audience,
  ChatError,
  permission,
  session,
} from "./contracts.js";

export function permissions(options: {
  authUrl: string;
  ticketsUrl: string;
  serviceToken: string;
  timeoutMs: number;
}) {
  async function call<T>(
    base: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    try {
      const response = await fetch(new URL(path, base), {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: {
          Authorization: `Bearer ${options.serviceToken}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.status === 401) throw new ChatError("UNAUTHORIZED");
      if (response.status === 403) throw new ChatError("FORBIDDEN");
      if (response.status === 404) throw new ChatError("NOT_FOUND");
      if (!response.ok) throw new ChatError("DEPENDENCY_UNAVAILABLE");
      return z.object({ data: schema }).parse(await response.json()).data;
    } catch (error) {
      if (error instanceof ChatError) throw error;
      throw new ChatError("DEPENDENCY_UNAVAILABLE");
    }
  }
  return {
    async identity(token: string) {
      const data = await call(
        options.authUrl,
        "/internal/v1/sessions/introspect",
        session,
        { sessionToken: token },
      );
      if (!data.active || Date.parse(data.expiresAt) <= Date.now())
        throw new ChatError("UNAUTHORIZED");
      return data.subject;
    },
    async authorize(token: string, ticketId: string, action: Action) {
      const data = await call(
        options.ticketsUrl,
        `/internal/v1/tickets/${ticketId}/authorize`,
        permission,
        { sessionToken: token, action },
      );
      if (!data.allowed) {
        if (data.code === "UNAUTHORIZED") throw new ChatError("UNAUTHORIZED");
        if (data.code === "CONFLICT") throw new ChatError("CONFLICT");
        if (data.code === "FORBIDDEN") throw new ChatError("FORBIDDEN");
        throw new ChatError("NOT_FOUND");
      }
      return data;
    },
    audience(ticketId: string) {
      return call(
        options.ticketsUrl,
        `/internal/v1/tickets/${ticketId}/chat-audience`,
        audience,
      );
    },
  };
}
