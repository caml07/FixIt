export type Role = "REPORTER" | "SUPPORT_AGENT" | "ADMIN";
export type TicketStatus =
  | "OPEN"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "CLOSED"
  | "CANCELLED";
export type Urgency = "LOW" | "NORMAL" | "HIGH";
export type Priority = "P1_CRITICAL" | "P2_HIGH" | "P3_NORMAL" | "P4_LOW";

export interface User {
  userId: string;
  role: Role;
  displayName: string;
  email: string;
}

export interface Ticket {
  id: string;
  reference: string;
  title: string;
  category: string;
  status: TicketStatus;
  urgency: Urgency;
  priority: Priority | null;
  reporterId: string;
  reporterName: string;
  assigneeId: string | null;
  assigneeName: string | null;
  createdAt: string;
  updatedAt: string;
  description: string;
  location?: string;
  equipment?: string;
  version: number;
}

export interface ChatMessage {
  id: string;
  ticketId: string;
  senderId: string;
  clientMessageId: string;
  body: string;
  createdAt: string;
}

export interface TicketDraft {
  title: string;
  category: string;
  description: string;
  urgency: Urgency;
  location?: string;
  equipment?: string;
}

export interface ActivityItem {
  id: string;
  label: string;
  detail: string;
  createdAt: string;
  actor: string;
}
