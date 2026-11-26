import {
  ArrowRight,
  Eye,
  EyeOff,
  LifeBuoy,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, useToast } from "../app/providers";
import { defaultPathForRole } from "../lib/auth";
import { previewAccounts } from "../lib/fixtures";

export function LoginPage() {
  const { signIn } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState(
    import.meta.env.DEV ? previewAccounts[1]!.email : "",
  );
  const [password, setPassword] = useState(
    import.meta.env.DEV ? previewAccounts[1]!.password : "",
  );
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const user = await signIn(email.trim(), password);
      navigate(defaultPathForRole(user.role), { replace: true });
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "We could not sign you in.";
      setError(message);
      showToast(message, "error");
    } finally {
      setPending(false);
    }
  }

  function chooseAccount(account: (typeof previewAccounts)[number]) {
    setEmail(account.email);
    setPassword(account.password);
    setError(null);
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="About FixIt">
        <div className="auth-story-top">
          <div className="brand-lockup brand-lockup-light">
            <span className="brand-mark">
              <LifeBuoy size={21} strokeWidth={2.2} />
            </span>
            <span>
              <strong>FixIt</strong>
              <small>IT support desk</small>
            </span>
          </div>
          <span className="auth-pilot-tag">LOCAL PREVIEW</span>
        </div>
        <div className="auth-story-copy">
          <h1>Keep every request moving.</h1>
          <p className="auth-story-description">
            One calm workspace for reporting issues, coordinating support, and keeping
            the next step visible.
          </p>
        </div>
        <div className="auth-ticket-preview">
          <div className="auth-preview-head">
            <span className="auth-preview-label">SAMPLE REQUEST</span>
            <span className="auth-preview-id">FX-1042</span>
          </div>
          <h2>Printer keeps dropping off the network</h2>
          <div className="auth-preview-foot">
            <span className="auth-preview-status">
              <i />
              Assigned
            </span>
            <span className="auth-preview-priority">P2 · High</span>
            <span className="auth-preview-agent">
              <span>JL</span> Jordan Lee
            </span>
          </div>
        </div>
        <div className="auth-story-foot">
          <span>
            <ShieldCheck size={15} /> Private, role-based support
          </span>
          <span>Built for focused work</span>
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand brand-lockup">
            <span className="brand-mark">
              <LifeBuoy size={20} strokeWidth={2.2} />
            </span>
            <span>
              <strong>FixIt</strong>
              <small>IT support desk</small>
            </span>
          </div>
          <div className="auth-heading">
            <span className="auth-form-icon">
              <LockKeyhole size={18} />
            </span>
            <h2>Welcome back</h2>
            <p>Sign in to your support workspace.</p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="email">
              Work email
            </label>
            <input
              autoComplete="username"
              className="text-input"
              id="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@university.edu"
              required
              type="email"
              value={email}
            />
            <div className="field-label-row">
              <label className="field-label" htmlFor="password">
                Password
              </label>
              <span className="field-helper">Local preview password</span>
            </div>
            <div className="password-input-wrap">
              <input
                autoComplete="current-password"
                className="text-input"
                id="password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                type="button"
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
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
              {pending ? "Signing in…" : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>

          {import.meta.env.DEV ? (
            <div className="preview-access">
              <div className="preview-access-heading">
                <span>Local preview access</span>
                <span className="preview-access-line" />
              </div>
              <p>
                Choose a sample role. The password is prefilled for this local build.
              </p>
              <div className="preview-account-list">
                {previewAccounts.map((account) => (
                  <button
                    className={`preview-account ${email === account.email ? "is-selected" : ""}`}
                    key={account.role}
                    onClick={() => chooseAccount(account)}
                    type="button"
                  >
                    <span className="preview-account-initials">
                      {account.name
                        .split(" ")
                        .map((part) => part[0])
                        .join("")}
                    </span>
                    <span>
                      <strong>
                        {account.role === "SUPPORT_AGENT"
                          ? "Support agent"
                          : account.role === "ADMIN"
                            ? "Administrator"
                            : "Reporter"}
                      </strong>
                      <small>{account.email}</small>
                    </span>
                  </button>
                ))}
              </div>
              <p className="preview-password-note">
                Preview password: <code>FixItPreview!</code>
              </p>
            </div>
          ) : null}
          <p className="auth-legal">
            Access is provisioned by your administrator. There is no public
            registration.
          </p>
        </div>
      </section>
    </main>
  );
}
