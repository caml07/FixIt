import { previewUsers, seedTickets } from "./fixtures";
import type { Priority, Ticket, TicketDraft, TicketStatus } from "./types";

const preview = import.meta.env.DEV;

type ApiEnvelope<T> = { data?: T; error?: { message?: string } };

async function readData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || body.data === undefined) {
    throw new Error(body.error?.message ?? "The ticket could not be updated.");
  }
  return body.data;
}

export const ticketsApi = {
  async list(): Promise<Ticket[]> {
    if (preview) {
      const response = await fetch("/__dev/tickets", { credentials: "include" });
      const data = await readData<{
        items: (Partial<Ticket> &
          Pick<Ticket, "id" | "status" | "assigneeId" | "version" | "priority">)[];
      }>(response);
      return data.items
        .map((item) => {
          const base = seedTickets.find((ticket) => ticket.id === item.id);
          const merged = { ...base, ...item } as Ticket;
          return {
            ...merged,
            updatedAt: merged.updatedAt ?? merged.createdAt,
            assigneeName:
              previewUsers.find((user) => user.userId === item.assigneeId)
                ?.displayName ?? null,
          };
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    const response = await fetch("/api/v1/tickets?limit=50", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const data = await readData<{ items: Ticket[] }>(response);
    return data.items;
  },
  async create(draft: TicketDraft): Promise<{
    ticketId: string;
    version: number;
    reference?: string;
    createdAt?: string;
  }> {
    const path = preview ? "/__dev/tickets" : "/api/v1/tickets";
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(draft),
    });
    return readData(response);
  },
  async claim(
    ticketId: string,
  ): Promise<{ status: TicketStatus; assigneeId: string; version: number }> {
    const path = preview
      ? `/__dev/tickets/${ticketId}/claim`
      : `/api/v1/tickets/${ticketId}/claim`;
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    return readData(response);
  },
  async updateStatus(
    ticketId: string,
    status: TicketStatus,
  ): Promise<{ status: TicketStatus; version: number }> {
    const path = preview
      ? `/__dev/tickets/${ticketId}/state`
      : `/api/v1/tickets/${ticketId}/status`;
    const response = await fetch(path, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ status }),
    });
    return readData(response);
  },
  async updatePriority(
    ticketId: string,
    priority: Priority,
    reason?: string,
  ): Promise<{ priority: Priority; version: number }> {
    const path = preview
      ? `/__dev/tickets/${ticketId}/priority`
      : `/api/v1/tickets/${ticketId}/priority`;
    const response = await fetch(path, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ priority, reason }),
    });
    return readData(response);
  },
};
