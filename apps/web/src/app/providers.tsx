import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useMountEffect } from "../hooks/useMountEffect";
import { authApi } from "../lib/auth";
import { ticketsApi } from "../lib/tickets";
import type { Priority, Ticket, TicketDraft, TicketStatus, User } from "../lib/types";

export type AuthState =
  | { status: "loading"; user: null }
  | { status: "signed-out"; user: null }
  | { status: "password-change"; user: User }
  | { status: "signed-in"; user: User };

interface AuthContextValue {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  activate: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  useMountEffect(() => {
    let active = true;
    authApi
      .current()
      .then(({ user, mustChangePassword }) => {
        if (active)
          setState({
            status: mustChangePassword ? "password-change" : "signed-in",
            user,
          });
      })
      .catch(() => {
        if (active) setState({ status: "signed-out", user: null });
      });
    return () => {
      active = false;
    };
  });

  const signIn = useCallback(async (email: string, password: string) => {
    const { user, mustChangePassword } = await authApi.login(email, password);
    setState({ status: mustChangePassword ? "password-change" : "signed-in", user });
    return user;
  }, []);

  const signOut = useCallback(async () => {
    await authApi.logout();
    setState({ status: "signed-out", user: null });
  }, []);

  const activate = useCallback(async (currentPassword: string, newPassword: string) => {
    await authApi.activate(currentPassword, newPassword);
    setState({ status: "signed-out", user: null });
  }, []);

  const value = useMemo(
    () => ({ state, signIn, signOut, activate }),
    [signIn, signOut, activate, state],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider.");
  return value;
}

interface TicketsContextValue {
  tickets: Ticket[];
  isLoading: boolean;
  createTicket: (draft: TicketDraft) => Promise<Ticket>;
  claimTicket: (ticketId: string, agent: User) => Promise<void>;
  updateStatus: (ticketId: string, status: TicketStatus) => Promise<void>;
  updatePriority: (
    ticketId: string,
    priority: Priority,
    reason?: string,
  ) => Promise<void>;
  getTicket: (ticketId: string) => Ticket | undefined;
}

const TicketsContext = createContext<TicketsContextValue | null>(null);

export function TicketsProvider({ children, user }: PropsWithChildren<{ user: User }>) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useMountEffect(() => {
    let active = true;
    ticketsApi
      .list()
      .then((items) => {
        if (active) setTickets(items);
      })
      .catch(() => {
        if (active) setTickets([]);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  });

  const createTicket = useCallback(
    async (draft: TicketDraft) => {
      const result = await ticketsApi.create(draft);
      const now = new Date().toISOString();
      const ticket: Ticket = {
        id: result.ticketId,
        reference: result.reference ?? `FX-${1043 + tickets.length}`,
        title: draft.title,
        category: draft.category,
        status: "OPEN",
        urgency: draft.urgency,
        priority: null,
        reporterId: user.userId,
        reporterName: user.displayName,
        assigneeId: null,
        assigneeName: null,
        createdAt: result.createdAt ?? now,
        updatedAt: now,
        description: draft.description,
        location: draft.location,
        equipment: draft.equipment,
        version: result.version,
      };
      setTickets((current) => [ticket, ...current]);
      return ticket;
    },
    [tickets.length, user],
  );

  const claimTicket = useCallback(async (ticketId: string, agent: User) => {
    const result = await ticketsApi.claim(ticketId);
    setTickets((current) =>
      current.map((ticket) =>
        ticket.id === ticketId
          ? {
              ...ticket,
              status: result.status,
              assigneeId: result.assigneeId,
              assigneeName: agent.displayName,
              updatedAt: new Date().toISOString(),
              version: result.version,
            }
          : ticket,
      ),
    );
  }, []);

  const updateStatus = useCallback(async (ticketId: string, status: TicketStatus) => {
    const result = await ticketsApi.updateStatus(ticketId, status);
    setTickets((current) =>
      current.map((ticket) =>
        ticket.id === ticketId
          ? {
              ...ticket,
              status: result.status,
              updatedAt: new Date().toISOString(),
              version: result.version,
            }
          : ticket,
      ),
    );
  }, []);

  const updatePriority = useCallback(
    async (ticketId: string, priority: Priority, reason?: string) => {
      const result = await ticketsApi.updatePriority(ticketId, priority, reason);
      setTickets((current) =>
        current.map((ticket) =>
          ticket.id === ticketId
            ? {
                ...ticket,
                priority: result.priority,
                updatedAt: new Date().toISOString(),
                version: result.version,
              }
            : ticket,
        ),
      );
    },
    [],
  );

  const getTicket = useCallback(
    (ticketId: string) => tickets.find((ticket) => ticket.id === ticketId),
    [tickets],
  );

  const value = useMemo(
    () => ({
      tickets,
      isLoading,
      createTicket,
      claimTicket,
      updateStatus,
      updatePriority,
      getTicket,
    }),
    [
      claimTicket,
      createTicket,
      getTicket,
      isLoading,
      tickets,
      updatePriority,
      updateStatus,
    ],
  );
  return <TicketsContext.Provider value={value}>{children}</TicketsContext.Provider>;
}

export function useTickets(): TicketsContextValue {
  const value = useContext(TicketsContext);
  if (!value) throw new Error("useTickets must be used inside TicketsProvider.");
  return value;
}

interface ToastContextValue {
  showToast: (message: string, tone?: "success" | "error" | "info") => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error" | "info";
  } | null>(null);
  const showToast = useCallback(
    (message: string, tone: "success" | "error" | "info" = "info") => {
      setToast({ message, tone });
      window.setTimeout(() => setToast(null), 3600);
    },
    [],
  );
  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast ? (
        <div className={`toast toast-${toast.tone}`} role="status" aria-live="polite">
          <span className="toast-mark" />
          {toast.message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used inside ToastProvider.");
  return value;
}
