import type { Role, User } from "./types";

const preview = import.meta.env.DEV;

async function readUser(response: Response): Promise<User> {
  const body = (await response.json()) as {
    data?: { user?: User };
    error?: { message?: string };
  };
  if (!response.ok || !body.data?.user) {
    throw new Error(body.error?.message ?? "We could not verify your session.");
  }
  return body.data.user;
}

export const authApi = {
  async current(): Promise<User> {
    const response = await fetch(preview ? "/__dev/auth/session" : "/api/v1/auth/me", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    return readUser(response);
  },
  async login(email: string, password: string): Promise<User> {
    const response = await fetch(preview ? "/__dev/auth/login" : "/api/v1/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return readUser(response);
  },
  async logout(): Promise<void> {
    if (preview) {
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
