import { LifeBuoy } from "lucide-react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { defaultPathForRole } from "../lib/auth";
import { LoginPage } from "../pages/LoginPage";
import { NewTicketPage } from "../pages/NewTicketPage";
import { TicketDetailPage } from "../pages/TicketDetailPage";
import { UsersPage } from "../pages/UsersPage";
import { WorkspacePage } from "../pages/WorkspacePage";
import { AuthProvider, TicketsProvider, ToastProvider, useAuth } from "./providers";

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <span className="brand-mark">
        <LifeBuoy size={22} />
      </span>
      <strong>FixIt</strong>
      <span>Preparing your workspace…</span>
    </main>
  );
}

function AppGate() {
  const { state } = useAuth();
  if (state.status === "loading") return <LoadingScreen />;
  if (state.status === "signed-out") {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  const user = state.user;
  const home = defaultPathForRole(user.role);
  return (
    <TicketsProvider user={user}>
      <Routes>
        <Route path="/" element={<Navigate replace to={home} />} />
        <Route path="/login" element={<Navigate replace to={home} />} />
        <Route element={<AppShell />}>
          {user.role === "REPORTER" ? (
            <>
              <Route path="/requests" element={<WorkspacePage scope="reporter" />} />
              <Route path="/requests/new" element={<NewTicketPage />} />
            </>
          ) : null}
          {user.role === "SUPPORT_AGENT" ? (
            <Route path="/inbox" element={<WorkspacePage scope="support" />} />
          ) : null}
          {user.role === "ADMIN" ? (
            <>
              <Route path="/all-tickets" element={<WorkspacePage scope="admin" />} />
              <Route path="/users" element={<UsersPage />} />
            </>
          ) : null}
          <Route path="/tickets/:ticketId" element={<TicketDetailPage />} />
          <Route path="*" element={<Navigate replace to={home} />} />
        </Route>
      </Routes>
    </TicketsProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AppGate />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
