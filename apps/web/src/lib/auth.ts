import type { Role, User } from "./types";

export const previewAuth =
  import.meta.env.DEV && import.meta.env.VITE_AUTH_MODE !== "real";

type AuthSession = { user: User; mustChangePassword: boolean };

async function readSession(response: Response): Promise<AuthSession> {
  const body = (await response.json()) as {
    data?: { user?: User & { id?: string }; mustChangePassword?: boolean };
    error?: { message?: string };
  };
  if (!response.ok || !body.data?.user) {
    throw new Error(body.error?.message ?? "We could not verify your session.");
  }
  const { user } = body.data;
  const userId = user.userId ?? user.id;
  if (!userId) throw new Error("We could not verify your session.");
  if (!previewAuth && typeof body.data.mustChangePassword !== "boolean") {
    throw new Error("We could not verify your session.");
  }
  return {
    user: { ...user, userId },
    mustChangePassword: body.data.mustChangePassword === true,
  };
}

export const authApi = {
  async current(): Promise<AuthSession> {
    const response = await fetch(
      previewAuth ? "/__dev/auth/session" : "/api/v1/auth/me",
      {
        credentials: "include",
        headers: { Accept: "application/json" },
      },
    );
    return readSession(response);
  },
  async login(email: string, password: string): Promise<AuthSession> {
    const response = await fetch(
      previewAuth ? "/__dev/auth/login" : "/api/v1/auth/login",
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, password }),
      },
    );
    return readSession(response);
  },
  async activate(currentPassword: string, newPassword: string): Promise<void> {
    const csrfResponse = await fetch("/api/v1/auth/csrf", { credentials: "include" });
    const csrfBody = (await csrfResponse.json()) as { data?: { csrfToken?: string } };
    if (!csrfResponse.ok || !csrfBody.data?.csrfToken)
      throw new Error("Could not refresh the security token.");
    const response = await fetch("/api/v1/auth/password/activate", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfBody.data.csrfToken,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (!response.ok)
      throw new Error("Could not change the password. Check it and try again.");
  },
  async logout(): Promise<void> {
    if (previewAuth) {
      await fetch("/__dev/auth/logout", { method: "POST", credentials: "include" });
      return;
    }
    const csrfResponse = await fetch("/api/v1/auth/csrf", { credentials: "include" });
    const csrfBody = (await csrfResponse.json()) as { data?: { csrfToken?: string } };
    const csrfToken = csrfBody.data?.csrfToken;
    if (!csrfResponse.ok || !csrfToken)
      throw new Error("Could not refresh the security token.");
    const response = await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: { "x-csrf-token": csrfToken },
    });
    if (!response.ok) throw new Error("Could not end this session.");
  },
};

export function defaultPathForRole(role: Role): string {
  if (role === "REPORTER") return "/requests";
  if (role === "ADMIN") return "/all-tickets";
  return "/inbox";
}
