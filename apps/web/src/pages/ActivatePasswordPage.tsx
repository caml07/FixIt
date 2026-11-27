import { type FormEvent, useState } from "react";
import { useAuth } from "../app/providers";

export function ActivatePasswordPage() {
  const { activate, signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await activate(currentPassword, newPassword);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not change the password.",
      );
    } finally {
      setPending(false);
    }
  }

  async function leave() {
    setPending(true);
    setError(null);
    try {
      await signOut();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign out.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="auth-page auth-page-single">
      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="auth-heading">
            <h1>Choose a new password</h1>
            <p>
              Change your temporary password to continue. You will sign in again
              afterward.
            </p>
          </div>
          <form className="auth-form" onSubmit={submit}>
            <label className="field-label" htmlFor="temporary-password">
              Temporary password
            </label>
            <input
              className="text-input"
              id="temporary-password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
            <label className="field-label" htmlFor="new-password">
              New password
            </label>
            <input
              className="text-input"
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={15}
              required
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <span className="field-helper">Use at least 15 characters.</span>
            {error ? (
              <p className="form-error" role="alert">
                {error}
              </p>
            ) : null}
            <button
              className="button button-primary auth-submit"
              disabled={pending}
              type="submit"
            >
              {pending ? "Updating…" : "Update password"}
            </button>
          </form>
          <button
            className="button button-secondary"
            disabled={pending}
            onClick={leave}
            type="button"
          >
            Sign out
          </button>
        </div>
      </section>
    </main>
  );
}
