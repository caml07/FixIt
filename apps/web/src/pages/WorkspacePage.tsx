import { ArrowRight, Plus, SlidersHorizontal, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth, useTickets, useToast } from "../app/providers";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { TicketTable } from "../components/TicketTable";
import type { Ticket, TicketStatus } from "../lib/types";

type Scope = "reporter" | "support" | "admin";
type SupportTab = "available" | "assigned";

const statusFilters: { value: "ALL" | TicketStatus; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "OPEN", label: "Open" },
  { value: "ASSIGNED", label: "Assigned" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

export function WorkspacePage({ scope }: { scope: Scope }) {
  const { state } = useAuth();
  const { tickets, claimTicket, isLoading } = useTickets();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [supportTab, setSupportTab] = useState<SupportTab>("available");
  const [statusFilter, setStatusFilter] = useState<"ALL" | TicketStatus>("ALL");
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const user = state.status === "signed-in" ? state.user : null;
  const userId = user?.userId ?? "";

  const scopedTickets = useMemo(() => {
    if (scope === "reporter")
      return tickets.filter((ticket) => ticket.reporterId === userId);
    if (scope === "support") {
      return supportTab === "available"
        ? tickets.filter((ticket) => ticket.status === "OPEN" && !ticket.assigneeId)
        : tickets.filter((ticket) => ticket.assigneeId === userId);
    }
    return tickets;
  }, [scope, supportTab, tickets, userId]);

  const visibleTickets = useMemo(
    () =>
      statusFilter === "ALL"
        ? scopedTickets
        : scopedTickets.filter((ticket) => ticket.status === statusFilter),
    [scopedTickets, statusFilter],
  );

  const availableCount = tickets.filter(
    (ticket) => ticket.status === "OPEN" && !ticket.assigneeId,
  ).length;
  const assignedCount = tickets.filter((ticket) => ticket.assigneeId === userId).length;

  async function handleClaim(ticket: Ticket) {
    if (!user) return;
    setClaimingId(ticket.id);
    try {
      await claimTicket(ticket.id, user);
      showToast(`${ticket.reference} is now assigned to you.`, "success");
      navigate(`/tickets/${ticket.id}`);
    } catch (cause) {
      showToast(
        cause instanceof Error ? cause.message : "This ticket could not be claimed.",
        "error",
      );
    } finally {
      setClaimingId(null);
    }
  }

  if (!user) return null;

  const heading =
    scope === "reporter"
      ? {
          title: "My requests",
          description: "A clear view of every issue you have reported.",
        }
      : scope === "admin"
        ? {
            title: "All tickets",
            description:
              "Monitor the queue, ownership, and current state of each request.",
          }
        : {
            title: "Support inbox",
            description: "Pick up unassigned requests and keep active work moving.",
          };

  return (
    <div className="page-content page-enter">
      <PageHeader
        title={heading.title}
        description={heading.description}
        action={
          scope === "reporter" ? (
            <Link className="button button-primary" to="/requests/new">
              <Plus size={17} />
              New request
            </Link>
          ) : scope === "admin" ? (
            <Link className="button button-secondary" to="/users">
              <Users size={16} />
              Manage users
              <ArrowRight size={15} />
            </Link>
          ) : null
        }
      />

      {scope === "support" ? (
        <div className="inbox-tabs" role="tablist" aria-label="Support inbox views">
          <button
            aria-selected={supportTab === "available"}
            className={`inbox-tab ${supportTab === "available" ? "inbox-tab-active" : ""}`}
            onClick={() => {
              setSupportTab("available");
              setStatusFilter("ALL");
            }}
            role="tab"
            type="button"
          >
            Available <span>{availableCount}</span>
          </button>
          <button
            aria-selected={supportTab === "assigned"}
            className={`inbox-tab ${supportTab === "assigned" ? "inbox-tab-active" : ""}`}
            onClick={() => {
              setSupportTab("assigned");
              setStatusFilter("ALL");
            }}
            role="tab"
            type="button"
          >
            Assigned to me <span>{assignedCount}</span>
          </button>
        </div>
      ) : null}

      <section className="queue-panel" aria-label={`${heading.title} list`}>
        <div className="queue-toolbar">
          <div className="queue-toolbar-copy">
            <strong>
              {visibleTickets.length}{" "}
              {visibleTickets.length === 1 ? "ticket" : "tickets"}
            </strong>
            <span>
              {scope === "support" && supportTab === "available"
                ? "Waiting for an owner"
                : "Sorted by most recently updated"}
            </span>
          </div>
          <label className="filter-select-wrap">
            <SlidersHorizontal size={15} />
            <span className="sr-only">Filter by status</span>
            <select
              aria-label="Filter by status"
              onChange={(event) =>
                setStatusFilter(event.target.value as "ALL" | TicketStatus)
              }
              value={statusFilter}
            >
              {statusFilters.map((filter) => (
                <option key={filter.value} value={filter.value}>
                  {filter.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isLoading ? (
          <p className="workspace-footnote">Loading tickets…</p>
        ) : visibleTickets.length ? (
          <TicketTable
            claimingId={claimingId}
            onClaim={
              scope === "support" && supportTab === "available"
                ? handleClaim
                : undefined
            }
            showAssignee={scope !== "reporter"}
            showRequester={scope !== "reporter"}
            tickets={visibleTickets}
          />
        ) : (
          <EmptyState
            title={
              statusFilter === "ALL" ? "Nothing in this view" : "No matching tickets"
            }
            description={
              scope === "support" && supportTab === "available"
                ? "New requests will appear here when they are ready to be claimed."
                : "Try another status filter or check back when the queue changes."
            }
            icon={<SlidersHorizontal size={21} />}
            action={
              scope === "reporter" ? (
                <Link className="text-link" to="/requests/new">
                  Create a request <ArrowRight size={14} />
                </Link>
              ) : undefined
            }
          />
        )}
      </section>

      {scope === "support" ? (
        <p className="workspace-footnote">
          Claiming a ticket assigns it to you. Conversation becomes available after
          ownership is confirmed.
        </p>
      ) : scope === "admin" ? (
        <p className="workspace-footnote">
          User and ticket changes in this local preview are not connected to the
          institutional directory.
        </p>
      ) : null}
    </div>
  );
}
