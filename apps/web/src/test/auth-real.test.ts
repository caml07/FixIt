import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_AUTH_MODE", "real");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("maps an Auth account and preserves the mandatory password change", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            user: {
              id: "user-1",
              email: "person@invalid.example",
              role: "REPORTER",
              displayName: "Person",
            },
            mustChangePassword: true,
          },
        }),
        { status: 200 },
      ),
    ),
  );
  const { authApi } = await import("../lib/auth");
  const session = await authApi.login("person@invalid.example", "temporary");
  expect(session.user.userId).toBe("user-1");
  expect(session.mustChangePassword).toBe(true);
});

it("does not treat an incomplete real Auth response as a full session", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            user: {
              id: "user-1",
              email: "person@invalid.example",
              role: "REPORTER",
              displayName: "Person",
            },
          },
        }),
        { status: 200 },
      ),
    ),
  );
  const { authApi } = await import("../lib/auth");
  await expect(authApi.current()).rejects.toThrow();
});

it("uses the session CSRF token to activate the temporary password", async () => {
  const csrf = crypto.randomUUID();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { csrfToken: csrf } }), {
        status: 200,
      }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  const { authApi } = await import("../lib/auth");
  await authApi.activate("temporary", "new synthetic password");
  expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/password/activate");
  expect(fetchMock.mock.calls[1]?.[1].headers["X-CSRF-Token"]).toBe(csrf);
});
