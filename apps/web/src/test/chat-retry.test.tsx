import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const socket = vi.hoisted(() => {
  const handlers = new Map<string, (...args: never[]) => void>();
  return {
    handlers,
    connected: true,
    on: vi.fn((event: string, handler: (...args: never[]) => void) =>
      handlers.set(event, handler),
    ),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connect: vi.fn(),
    timeout: vi.fn(),
  };
});
vi.mock("socket.io-client", () => ({ io: () => socket }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  socket.handlers.clear();
});

it("reuses the message id when a send times out and is retried", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ data: { items: [] } }), { status: 200 }),
      ),
  );
  const sent: string[] = [];
  let first = true;
  socket.timeout.mockImplementation(() => ({
    emitWithAck: async (event: string, data: { clientMessageId?: string }) => {
      if (event === "ticket:join") return { ok: true };
      sent.push(data.clientMessageId ?? "");
      if (first) {
        first = false;
        throw new Error("timeout");
      }
      return { ok: true };
    },
  }));
  const { useChatRoom } = await import("../hooks/useChatRoom");
  const { result, unmount } = renderHook(() =>
    useChatRoom({ ticketId: "ticket", enabled: true, canSend: true }),
  );
  await act(async () => {
    socket.handlers.get("connect")?.();
  });
  await waitFor(() => expect(result.current.state).toBe("connected"));
  await expect(result.current.send("Hello")).rejects.toThrow("timeout");
  await act(async () => {
    await result.current.send("Hello");
  });
  expect(sent).toHaveLength(2);
  expect(sent[0]).toBe(sent[1]);
  unmount();
});

it("reconnects when joining the ticket failed while the socket stayed connected", async () => {
  socket.disconnect.mockClear();
  socket.connect.mockClear();
  socket.timeout.mockImplementation(() => ({
    emitWithAck: async () => ({ ok: false, error: { message: "Unavailable" } }),
  }));
  const { useChatRoom } = await import("../hooks/useChatRoom");
  const { result, unmount } = renderHook(() =>
    useChatRoom({ ticketId: "ticket", enabled: true, canSend: true }),
  );
  await act(async () => {
    socket.handlers.get("connect")?.();
  });
  await waitFor(() => expect(result.current.state).toBe("error"));
  act(() => result.current.retry());
  expect(socket.disconnect).toHaveBeenCalledOnce();
  expect(socket.connect).toHaveBeenCalledOnce();
  unmount();
});
