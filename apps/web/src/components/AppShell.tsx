import {
  ClipboardList,
  Inbox,
  LifeBuoy,
  LogOut,
  Menu,
  Plus,
  Settings2,
  Users,
  X,
} from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useToast } from "../app/providers";
import type { Role } from "../lib/types";
import { Avatar } from "./Avatar";

const navByRole: Record<Role, { label: string; to: string; icon: typeof Inbox }[]> = {
  REPORTER: [
    { label: "My requests", to: "/requests", icon: ClipboardList },
    { label: "New request", to: "/requests/new", icon: Plus },
  ],
  SUPPORT_AGENT: [{ label: "Support inbox", to: "/inbox", icon: Inbox }],
  ADMIN: [
    { label: "All tickets", to: "/all-tickets", icon: ClipboardList },
    { label: "User management", to: "/users", icon: Users },
  ],
};

const roleLabels: Record<Role, string> = {
  REPORTER: "Reporter",
  SUPPORT_AGENT: "Support agent",
  ADMIN: "Administrator",
};

function pageTitle(pathname: string): string {
  if (pathname.startsWith("/tickets/")) return "Ticket details";
  if (pathname === "/requests/new") return "New request";
  if (pathname === "/requests") return "My requests";
  if (pathname === "/users") return "User management";
  if (pathname === "/all-tickets") return "All tickets";
  return "Support inbox";
}

export function AppShell() {
  const { state, signOut } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  if (state.status !== "signed-in") return null;
  const user = state.user;

  async function handleSignOut() {
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (cause) {
      showToast(
        cause instanceof Error ? cause.message : "Could not sign out.",
        "error",
      );
    }
  }

  return (
    <div className="app-shell">
      {sidebarOpen ? (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      ) : null}
      <aside className={`app-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-brand-row">
          <div className="brand-lockup brand-lockup-light">
            <span className="brand-mark">
              <LifeBuoy size={20} strokeWidth={2.2} />
            </span>
            <span>
              <strong>FixIt</strong>
              <small>IT support desk</small>
            </span>
          </div>
          <button
            className="sidebar-close mobile-only"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
            type="button"
          >
            <X size={19} />
          </button>
        </div>
        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Primary navigation">
          {navByRole[user.role].map(({ label, to, icon: Icon }) => (
            <NavLink
              className={({ isActive }) =>
                `sidebar-link ${isActive ? "sidebar-link-active" : ""}`
              }
              key={to}
              onClick={() => setSidebarOpen(false)}
              to={to}
            >
              <Icon size={18} strokeWidth={1.9} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-preview-card">
            <span className="sidebar-preview-dot" />
            <div>
              <strong>Local preview</strong>
              <small>Sample data · no live accounts</small>
            </div>
          </div>
          <div className="sidebar-version">
            FIXIT WORKSPACE <span>0.1.0</span>
          </div>
        </div>
      </aside>

      <div className="app-frame">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu-button mobile-only"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
              type="button"
            >
              <Menu size={20} />
            </button>
            <div className="topbar-breadcrumb">
              <span>Workspace</span>
              <span className="breadcrumb-slash">/</span>
              <strong>{pageTitle(location.pathname)}</strong>
            </div>
          </div>
          <div className="topbar-actions">
            <span className="preview-pill">
              <span />
              Local preview
            </span>
            <div className="account-menu-wrap">
              <button
                className="account-trigger"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((current) => !current)}
                type="button"
              >
                <Avatar name={user.displayName} size="small" tone="forest" />
                <span className="account-trigger-copy">
                  <strong>{user.displayName}</strong>
                  <small>{roleLabels[user.role]}</small>
                </span>
                <Settings2 size={16} className="account-trigger-icon" />
              </button>
              {accountOpen ? (
                <div className="account-menu">
                  <div className="account-menu-user">
                    <strong>{user.displayName}</strong>
                    <span>{user.email}</span>
                  </div>
                  <button
                    className="account-menu-action"
                    onClick={handleSignOut}
                    type="button"
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="preview-notice">
          <span className="preview-notice-mark">i</span>
          <span>
            Preview environment — ticket changes are local; Chat messages are stored in
            the local MongoDB service.
          </span>
        </div>
        <main className="workspace-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
