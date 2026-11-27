import { useCallback, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ChatMessage } from "../lib/types";
import { useMountEffect } from "./useMountEffect";

type RoomState = "locked" | "connecting" | "connected" | "offline" | "error";
type HistoryEnvelope = {
  data?: { items?: ChatMessage[]; nextCursor?: string | null };
  error?: { message?: string };
};
type Ack = { ok: boolean; error?: { message?: string } };

interface UseChatRoomOptions {
  ticketId: string;
  enabled: boolean;
  canSend: boolean;
}

export function useChatRoom({ ticketId, enabled, canSend }: UseChatRoomOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [state, setState] = useState<RoomState>(enabled ? "connecting" : "locked");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const pendingMessage = useRef<{ body: string; id: string } | null>(null);

  const mergeMessages = useCallback((incoming: ChatMessage[]) => {
    setMessages((current) => {
      const merged = new Map(current.map((message) => [message.id, message]));
      for (const message of incoming) merged.set(message.id, message);
      return [...merged.values()].sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt),
      );
    });
  }, []);

  const loadHistory = useCallback(async () => {
    const response = await fetch(`/api/v1/tickets/${ticketId}/messages?limit=50`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const body = (await response.json()) as HistoryEnvelope;
    if (!response.ok || !body.data?.items) {
      throw new Error(body.error?.message ?? "Conversation history is unavailable.");
    }
    mergeMessages(body.data.items);
  }, [mergeMessages, ticketId]);

  useMountEffect(() => {
    if (!enabled) {
      setState("locked");
      return;
    }

    let disposed = false;
    const socket = io({
      path: "/socket.io",
      transports: ["websocket"],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 700,
    });
    socketRef.current = socket;

    socket.on("connect", async () => {
      if (disposed) return;
      setState("connecting");
      setError(null);
      try {
        const ack = (await socket
          .timeout(5000)
          .emitWithAck("ticket:join", { ticketId })) as Ack;
        if (!ack.ok)
          throw new Error(
            ack.error?.message ?? "You no longer have access to this ticket.",
          );
        await loadHistory();
        if (!disposed) setState("connected");
      } catch (cause) {
        if (!disposed) {
          setState("error");
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not open this conversation.",
          );
        }
      }
    });

    socket.on("chat:message", (message: ChatMessage) => {
      if (!disposed) mergeMessages([message]);
    });
    socket.on("disconnect", () => {
      if (!disposed) setState("offline");
    });
    socket.on("connect_error", () => {
      if (!disposed) {
        setState("offline");
        setError("Live connection interrupted. Retrying automatically.");
      }
    });

    return () => {
      disposed = true;
      if (socket.connected) {
        socket.emit("ticket:leave", { ticketId }, () => socket.disconnect());
      } else {
        socket.disconnect();
      }
      socketRef.current = null;
    };
  });

  const send = useCallback(
    async (body: string) => {
      const socket = socketRef.current;
      if (!canSend) throw new Error("This conversation is read-only.");
      if (!socket?.connected) throw new Error("The live connection is not ready yet.");
      if (pendingMessage.current?.body !== body) {
        pendingMessage.current = { body, id: crypto.randomUUID() };
      }
      const ack = (await socket.timeout(5000).emitWithAck("chat:send", {
        ticketId,
        clientMessageId: pendingMessage.current.id,
        body,
      })) as Ack;
      if (!ack.ok) throw new Error(ack.error?.message ?? "Message could not be sent.");
      await loadHistory();
      pendingMessage.current = null;
    },
    [canSend, loadHistory, ticketId],
  );

  const retry = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    if (socket.connected) socket.disconnect();
    setState("connecting");
    setError(null);
    socket.connect();
  }, []);

  return { messages, state, error, send, retry };
}
