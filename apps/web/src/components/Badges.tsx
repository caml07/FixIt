import type { Priority, TicketStatus, Urgency } from "../lib/types";

const statusLabels: Record<TicketStatus, string> = {
  OPEN: "Open",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

const priorityLabels: Record<Priority, string> = {
  P1_CRITICAL: "P1 · Critical",
  P2_HIGH: "P2 · High",
  P3_NORMAL: "P3 · Normal",
  P4_LOW: "P4 · Low",
};

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span
      className={`status-badge status-${status.toLowerCase().replaceAll("_", "-")}`}
    >
      <span className="status-dot" aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority | null }) {
  if (!priority) return <span className="priority-unset">Not set</span>;
  return (
    <span
      className={`priority-badge priority-${priority.toLowerCase().replaceAll("_", "-")}`}
    >
      {priorityLabels[priority]}
    </span>
  );
}

export function UrgencyBadge({ urgency }: { urgency: Urgency }) {
  return (
    <span className={`urgency-badge urgency-${urgency.toLowerCase()}`}>
      {urgency.toLowerCase()} urgency
    </span>
  );
}
