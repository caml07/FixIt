import { ArrowUpRight, ChevronRight, Clock3 } from "lucide-react";
import { Link } from "react-router-dom";
import { categoryOptions } from "../lib/fixtures";
import type { Ticket } from "../lib/types";
import { Avatar } from "./Avatar";
import { PriorityBadge, StatusBadge } from "./Badges";

function categoryLabel(value: string): string {
  return categoryOptions.find((category) => category.value === value)?.label ?? value;
}

function formatUpdated(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

interface TicketTableProps {
  tickets: Ticket[];
  showRequester?: boolean;
  showAssignee?: boolean;
  onClaim?: (ticket: Ticket) => void;
  claimingId?: string | null;
}

export function TicketTable({
  tickets,
  showRequester = true,
  showAssignee = true,
  onClaim,
  claimingId,
}: TicketTableProps) {
  return (
    <>
      <div className="ticket-table-wrap">
        <table className="ticket-table">
          <thead>
            <tr>
              <th scope="col">Ticket</th>
              {showRequester ? <th scope="col">Requester</th> : null}
              <th scope="col">Category</th>
              {showAssignee ? <th scope="col">Assigned to</th> : null}
              <th scope="col">Updated</th>
              <th scope="col">Priority</th>
              <th scope="col">Status</th>
              {onClaim ? (
                <th scope="col">
                  <span className="sr-only">Action</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {tickets.map((ticket) => (
              <tr key={ticket.id} data-testid={`ticket-row-${ticket.reference}`}>
                <td className="ticket-cell-main">
                  <Link className="ticket-title-link" to={`/tickets/${ticket.id}`}>
                    <span className="ticket-ref">{ticket.reference}</span>
                    <span className="ticket-subject">{ticket.title}</span>
                  </Link>
                </td>
                {showRequester ? (
                  <td>
                    <div className="person-cell">
                      <Avatar name={ticket.reporterName} size="small" />{" "}
                      <span>{ticket.reporterName}</span>
                    </div>
                  </td>
                ) : null}
                <td>
                  <span className="category-label">
                    {categoryLabel(ticket.category)}
                  </span>
                </td>
                {showAssignee ? (
                  <td>
                    {ticket.assigneeName ? (
                      <div className="person-cell">
                        <Avatar name={ticket.assigneeName} size="small" tone="forest" />{" "}
                        <span>{ticket.assigneeName}</span>
                      </div>
                    ) : (
                      <span className="muted-inline">Unassigned</span>
                    )}
                  </td>
                ) : null}
                <td>
                  <span className="updated-cell">
                    <Clock3 size={13} />
                    {formatUpdated(ticket.updatedAt)}
                  </span>
                </td>
                <td>
                  <PriorityBadge priority={ticket.priority} />
                </td>
                <td>
                  <StatusBadge status={ticket.status} />
                </td>
                {onClaim ? (
                  <td className="table-action-cell">
                    <button
                      className="table-claim-button"
                      type="button"
                      disabled={ticket.status !== "OPEN" || claimingId === ticket.id}
                      onClick={() => onClaim(ticket)}
                    >
                      {claimingId === ticket.id ? "Claiming" : "Claim"}
                      <ArrowUpRight size={14} />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ticket-cards-mobile">
        {tickets.map((ticket) => (
          <article className="ticket-mobile-card" key={ticket.id}>
            <div className="ticket-mobile-topline">
              <span className="ticket-ref">{ticket.reference}</span>
              <StatusBadge status={ticket.status} />
            </div>
            <Link className="ticket-mobile-title" to={`/tickets/${ticket.id}`}>
              {ticket.title}
            </Link>
            <div className="ticket-mobile-meta">
              <span>{categoryLabel(ticket.category)}</span>
              <span>{formatUpdated(ticket.updatedAt)}</span>
            </div>
            <div className="ticket-mobile-bottom">
              <div className="ticket-mobile-person">
                <Avatar
                  name={ticket.assigneeName ?? ticket.reporterName}
                  size="small"
                />
                <span>{ticket.assigneeName ?? "Waiting for an agent"}</span>
              </div>
              <PriorityBadge priority={ticket.priority} />
              {onClaim ? (
                <button
                  className="table-claim-button"
                  type="button"
                  disabled={ticket.status !== "OPEN" || claimingId === ticket.id}
                  onClick={() => onClaim(ticket)}
                >
                  Claim <ChevronRight size={14} />
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
