export type Role = "REPORTER" | "SUPPORT_AGENT" | "ADMIN";
export type AuthResult =
  | { kind: "active"; userId: string; role: Role; sessionToken: string }
  | { kind: "invalid" }
  | { kind: "unavailable" };

export async function authenticate(cookieHeader: string, authUrl: string, serviceToken: string): Promise<AuthResult> {
  const cookies = cookieHeader.split(";").map((part) => part.trim())
    .filter((part) => part.startsWith("__Host-fixit_session="));
  if (cookies.length !== 1) return { kind: "invalid" };
  const sessionToken = cookies[0].slice("__Host-fixit_session=".length);
  if (!sessionToken || sessionToken.length > 256) return { kind: "invalid" };
  return authenticateToken(sessionToken, authUrl, serviceToken);
}

export async function authenticateToken(sessionToken: string, authUrl: string, serviceToken: string): Promise<AuthResult> {
  if (!sessionToken || sessionToken.length > 256) return { kind: "invalid" };
  try {
    const response = await fetch(new URL("/internal/v1/sessions/introspect", authUrl), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(3000),
      headers: { "content-type": "application/json", authorization: `Bearer ${serviceToken}` },
      body: JSON.stringify({ sessionToken })
    });
    if (!response.ok) return { kind: "unavailable" };
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || !("data" in payload) ||
        typeof payload.data !== "object" || payload.data === null || !("active" in payload.data) ||
        typeof payload.data.active !== "boolean") return { kind: "unavailable" };
    if (!payload.data.active) return { kind: "invalid" };
    if (!("subject" in payload.data) || typeof payload.data.subject !== "object" ||
        payload.data.subject === null || !("role" in payload.data.subject) ||
        !("userId" in payload.data.subject) || typeof payload.data.subject.userId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.data.subject.userId) ||
        !("expiresAt" in payload.data) || typeof payload.data.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(payload.data.expiresAt))) return { kind: "unavailable" };
    const role = payload.data.subject.role;
    if (role !== "REPORTER" && role !== "SUPPORT_AGENT" && role !== "ADMIN") return { kind: "unavailable" };
    if (Date.parse(payload.data.expiresAt) <= Date.now()) return { kind: "invalid" };
    return { kind: "active", role, userId: payload.data.subject.userId, sessionToken };
  } catch {
    return { kind: "unavailable" };
  }
}
