import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  LockKeyhole,
  MapPin,
  Monitor,
  Send,
  ShieldCheck,
  UserRound,
  Wifi,
  WifiOff,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth, useTickets, useToast } from "../app/providers";
import { Avatar } from "../components/Avatar";
import { PriorityBadge, StatusBadge, UrgencyBadge } from "../components/Badges";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useChatRoom } from "../hooks/useChatRoom";
import { activityByTicket, categoryOptions } from "../lib/fixtures";
import type { ChatMessage, Priority, Ticket, TicketStatus, User } from "../lib/types";

function categoryLabel(value: string): string {
  return categoryOptions.find((category) => category.value === value)?.label ?? value;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(
    new Date(value),
  );
}

function MessageBubble({
  message,
  own,
  senderName,
}: {
  message: ChatMessage;
  own: boolean;
  senderName: string;
}) {
  return (
    <article className={`message-row ${own ? "message-row-own" : ""}`}>
      {!own ? <Avatar name={senderName} size="small" tone="forest" /> : null}
      <div className="message-content">
        <div className="message-meta">
          <strong>{own ? "You" : senderName}</strong>
          <time dateTime={message.createdAt}>{formatTime(message.createdAt)}</time>
        </div>
        <p className="message-bubble">{message.body}</p>
      </div>
      {own ? <Avatar name={senderName} size="small" /> : null}
    </article>
  );
}

function ChatConversation({ ticket, user }: { ticket: Ticket; user: User }) {
  const enabled = ticket.status !== "OPEN" && ticket.status !== "CANCELLED";
  const canSend = ticket.status === "ASSIGNED" || ticket.status === "IN_PROGRESS";
  const { messages, state, error, send, retry } = useChatRoom({
    ticketId: ticket.id,
    enabled,
    canSend,
  });
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = body.trim();
    if (!message || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await send(message);
      setBody("");
    } catch (cause) {
      setSendError(
        cause instanceof Error ? cause.message : "Message could not be sent.",
      );
    } finally {
      setSending(false);
    }
  }

  const stateLabel =
    state === "connected"
      ? "Live"
      : state === "connecting"
        ? "Connecting"
        : state === "locked"
          ? "Waiting for assignment"
          : state === "offline"
            ? "Reconnecting"
            : "Unavailable";

  return (
    <section className="conversation-panel" aria-label="Ticket conversation">
      <div className="conversation-heading">
        <div>
          <h2>Conversation</h2>
          <p>Messages shared with the people working on this ticket.</p>
        </div>
        <span className={`connection-pill connection-${state}`}>
          {state === "connected" ? (
            <Wifi size={13} />
          ) : state === "offline" || state === "error" ? (
            <WifiOff size={13} />
          ) : (
            <span className="connection-dot" />
          )}
          {stateLabel}
        </span>
      </div>

      {!enabled ? (
        <div className="conversation-locked">
          <span>
            <LockKeyhole size={20} />
          </span>
          <h3>Conversation opens after assignment</h3>
          <p>
            This request is waiting for a support agent. Once someone claims it, you can
            share updates here.
          </p>
        </div>
      ) : (
        <>
          {error ? (
            <div className="chat-inline-error" role="status">
              <span>{error}</span>
              {state === "offline" || state === "error" ? (
                <button onClick={retry} type="button">
                  Retry connection
                </button>
              ) : null}
            </div>
          ) : null}
          <div
            className="message-list"
            aria-live="polite"
            aria-relevant="additions text"
          >
            {messages.length ? (
              messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  own={message.senderId === user.userId}
                  senderName={
                    message.senderId === user.userId
                      ? user.displayName
                      : message.senderId === ticket.reporterId
                        ? ticket.reporterName
                        : (ticket.assigneeName ?? "Support team")
                  }
                />
              ))
            ) : state === "connected" ? (
              <div className="conversation-empty">
                <span>
                  <Activity size={18} />
                </span>
                <strong>No messages yet</strong>
                <p>
                  Start with a short update about what you have tried or what happens
                  next.
                </p>
              </div>
            ) : (
              <div className="conversation-loading">
                <span className="loading-line" />
                <span className="loading-line loading-line-short" />
                <span className="loading-line loading-line-mid" />
              </div>
            )}
          </div>
          {canSend ? (
            <form className="message-composer" onSubmit={handleSend}>
              <textarea
                aria-label="Write a message"
                maxLength={2000}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="Write an update…"
                rows={2}
                value={body}
              />
              <div className="composer-footer">
                <span>{body.length}/2000 · Ctrl + Enter to send</span>
                <button
                  className="button button-primary composer-send"
                  disabled={!body.trim() || sending || state !== "connected"}
                  type="submit"
                >
                  {sending ? "Sending…" : "Send message"}
                  <Send size={15} />
                </button>
              </div>
              {sendError ? (
                <p className="form-error composer-error" role="alert">
                  {sendError}
                </p>
              ) : null}
            </form>
          ) : (
            <div className="conversation-readonly">
              <ShieldCheck size={15} /> This conversation is read-only because the
              ticket is {ticket.status.toLowerCase().replaceAll("_", " ")}.
            </div>
          )}
        </>
      )}
    </section>
  );
}

function DetailsPanel({
  ticket,
  user,
  onPriorityChange,
}: {
  ticket: Ticket;
  user: User;
  onPriorityChange: (priority: Priority, reason?: string) => Promise<void>;
}) {
  const canSetPriority =
    user.role === "ADMIN" ||
    (user.role === "SUPPORT_AGENT" && ticket.assigneeId === user.userId);
  const [priorityValue, setPriorityValue] = useState<Priority>(
    ticket.priority ?? "P3_NORMAL",
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function savePriority() {
    setSaving(true);
    setError(null);
    try {
      await onPriorityChange(
        priorityValue,
        ticket.priority ? reason.trim() : undefined,
      );
      setReason("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Priority could not be updated.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="detail-rail-panel">
      <div className="rail-panel-heading">
        <h2>Details</h2>
        <span>Ticket record</span>
      </div>
      <div className="issue-summary">
        <h3>Issue description</h3>
        <p>{ticket.description}</p>
      </div>
      <dl className="ticket-details-list">
        <div>
          <dt>Category</dt>
          <dd>{categoryLabel(ticket.category)}</dd>
        </div>
        <div>
          <dt>Urgency proposed</dt>
          <dd>
            <UrgencyBadge urgency={ticket.urgency} />
          </dd>
        </div>
        <div>
          <dt>Official priority</dt>
          <dd>
            <PriorityBadge priority={ticket.priority} />
          </dd>
        </div>
        <div>
          <dt>Requester</dt>
          <dd>
            <span className="detail-person">
              <Avatar name={ticket.reporterName} size="small" />
              <span>{ticket.reporterName}</span>
            </span>
          </dd>
        </div>
        <div>
          <dt>Assigned to</dt>
          <dd>
            {ticket.assigneeName ? (
              <span className="detail-person">
                <Avatar name={ticket.assigneeName} size="small" tone="forest" />
                <span>{ticket.assigneeName}</span>
              </span>
            ) : (
              <span className="muted-inline">Unassigned</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatDate(ticket.createdAt)}</dd>
        </div>
        {ticket.location ? (
          <div>
            <dt>Location</dt>
            <dd>
              <MapPin size={14} />
              {ticket.location}
            </dd>
          </div>
        ) : null}
        {ticket.equipment ? (
          <div>
            <dt>Equipment</dt>
            <dd>
              <Monitor size={14} />
              {ticket.equipment}
            </dd>
          </div>
        ) : null}
      </dl>
      {canSetPriority && ["ASSIGNED", "IN_PROGRESS"].includes(ticket.status) ? (
        <div className="priority-editor">
          <label className="field-label" htmlFor="official-priority">
            Set official priority
          </label>
          <select
            className="text-input select-input"
            id="official-priority"
            onChange={(event) => setPriorityValue(event.target.value as Priority)}
            value={priorityValue}
          >
            <option value="P1_CRITICAL">P1 · Critical</option>
            <option value="P2_HIGH">P2 · High</option>
            <option value="P3_NORMAL">P3 · Normal</option>
            <option value="P4_LOW">P4 · Low</option>
          </select>
          {ticket.priority ? (
            <input
              className="text-input priority-reason-input"
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason for changing priority"
              value={reason}
            />
          ) : null}
          <button
            className="button button-secondary button-full"
            disabled={
              saving ||
              priorityValue === ticket.priority ||
              (Boolean(ticket.priority) && reason.trim().length < 10)
            }
            onClick={savePriority}
            type="button"
          >
            {saving ? "Saving…" : "Save priority"}
          </button>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ActivityPanel({ ticket }: { ticket: Ticket }) {
  const items = activityByTicket[ticket.id] ?? [];
  return (
    <section className="detail-rail-panel activity-panel">
      <div className="rail-panel-heading">
        <h2>Activity</h2>
        <span>Audit trail</span>
      </div>
      {items.length ? (
        <ol className="activity-list">
          {items.map((item) => (
            <li key={item.id}>
              <span className="activity-marker" />
              <div className="activity-item-copy">
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
                <div>
                  <span>{item.actor}</span>
                  <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="activity-empty">Updates to this request will appear here.</p>
      )}
    </section>
  );
}

function TicketDetailView({ ticket }: { ticket: Ticket }) {
  const { state } = useAuth();
  const { claimTicket, updateStatus, updatePriority } = useTickets();
  const { showToast } = useToast();
  const [activeMobileTab, setActiveMobileTab] = useState<"conversation" | "details">(
    "conversation",
  );
  const [actionPending, setActionPending] = useState(false);
  if (state.status !== "signed-in") return null;
  const user = state.user;
  const isAssignedAgent =
    user.role === "SUPPORT_AGENT" && ticket.assigneeId === user.userId;
  const backTo =
    user.role === "REPORTER"
      ? "/requests"
      : user.role === "ADMIN"
        ? "/all-tickets"
        : "/inbox";

  async function runStatusAction(status: TicketStatus, success: string) {
    setActionPending(true);
    try {
      await updateStatus(ticket.id, status);
      showToast(success, "success");
    } catch (cause) {
      showToast(
        cause instanceof Error ? cause.message : "The ticket could not be updated.",
        "error",
      );
    } finally {
      setActionPending(false);
    }
  }

  async function handleClaim() {
    setActionPending(true);
    try {
      await claimTicket(ticket.id, user);
      showToast("Ticket assigned to you. Conversation is now available.", "success");
    } catch (cause) {
      showToast(
        cause instanceof Error ? cause.message : "This ticket could not be claimed.",
        "error",
      );
    } finally {
      setActionPending(false);
    }
  }

  async function handlePriorityChange(priority: Priority, reason?: string) {
    await updatePriority(ticket.id, priority, reason);
    showToast("Official priority updated.", "success");
  }

  const action =
    ticket.status === "OPEN" && user.role === "SUPPORT_AGENT" ? (
      <button
        className="button button-primary"
        disabled={actionPending}
        onClick={handleClaim}
        type="button"
      >
        {actionPending ? "Claiming…" : "Claim ticket"}
        <ArrowRight size={16} />
      </button>
    ) : ticket.status === "ASSIGNED" && isAssignedAgent ? (
      <button
        className="button button-primary"
        disabled={actionPending}
        onClick={() => runStatusAction("IN_PROGRESS", "Work started.")}
        type="button"
      >
        {actionPending ? "Updating…" : "Start work"}
        <ArrowRight size={16} />
      </button>
    ) : ticket.status === "IN_PROGRESS" && isAssignedAgent ? (
      <button
        className="button button-primary"
        disabled={actionPending}
        onClick={() => runStatusAction("RESOLVED", "Ticket marked as resolved.")}
        type="button"
      >
        {actionPending ? "Updating…" : "Mark resolved"}
        <Check size={16} />
      </button>
    ) : ticket.status === "RESOLVED" && user.role === "REPORTER" ? (
      <button
        className="button button-primary"
        disabled={actionPending}
        onClick={() =>
          runStatusAction("CLOSED", "Request closed. Thank you for confirming.")
        }
        type="button"
      >
        {actionPending ? "Updating…" : "Confirm & close"}
        <Check size={16} />
      </button>
    ) : null;

  return (
    <div className="page-content page-enter">
      <PageHeader
        title={ticket.title}
        description={`${ticket.reference} · ${categoryLabel(ticket.category)} · Updated ${formatDate(ticket.updatedAt)}`}
        back={
          <Link className="back-link" to={backTo}>
            <ArrowLeft size={15} />
            Back to{" "}
            {user.role === "REPORTER"
              ? "my requests"
              : user.role === "ADMIN"
                ? "all tickets"
                : "inbox"}
          </Link>
        }
        action={action}
      />
      <div className="ticket-detail-statusline">
        <StatusBadge status={ticket.status} />
        <PriorityBadge priority={ticket.priority} />
        <UrgencyBadge urgency={ticket.urgency} />
        <span className="ticket-version-label">Record v{ticket.version}</span>
      </div>

      <div
        className="detail-mobile-tabs"
        role="tablist"
        aria-label="Ticket detail sections"
      >
        <button
          aria-selected={activeMobileTab === "conversation"}
          className={activeMobileTab === "conversation" ? "is-active" : ""}
          onClick={() => setActiveMobileTab("conversation")}
          role="tab"
          type="button"
        >
          Conversation
        </button>
        <button
          aria-selected={activeMobileTab === "details"}
          className={activeMobileTab === "details" ? "is-active" : ""}
          onClick={() => setActiveMobileTab("details")}
          role="tab"
          type="button"
        >
          Details & activity
        </button>
      </div>

      <div className="ticket-detail-grid">
        <div
          className={`ticket-detail-main ${activeMobileTab === "details" ? "mobile-section-hidden" : ""}`}
        >
          <ChatConversation
            key={`${ticket.id}:${ticket.status}`}
            ticket={ticket}
            user={user}
          />
        </div>
        <aside
          className={`ticket-detail-rail ${activeMobileTab === "conversation" ? "mobile-section-hidden" : ""}`}
        >
          <DetailsPanel
            key={`${ticket.id}:${ticket.priority ?? "unset"}`}
            onPriorityChange={handlePriorityChange}
            ticket={ticket}
            user={user}
          />
          <ActivityPanel ticket={ticket} />
        </aside>
      </div>
      <div className="ticket-detail-footer">
        <Clock3 size={14} />
        Ticket changes are local to this preview until the Tickets service is
        integrated.
      </div>
    </div>
  );
}

export function TicketDetailPage() {
  const { ticketId = "" } = useParams();
  const { getTicket, isLoading } = useTickets();
  const ticket = getTicket(ticketId);
  if (isLoading) return <div className="page-content">Loading ticket…</div>;
  if (!ticket) {
    return (
      <div className="page-content page-enter">
        <EmptyState
          title="Ticket not found"
          description="This ticket is not available in the current preview dataset."
          icon={<UserRound size={20} />}
        />
      </div>
    );
  }
  return <TicketDetailView key={ticket.id} ticket={ticket} />;
}
