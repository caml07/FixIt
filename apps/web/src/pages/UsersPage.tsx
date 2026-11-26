import { Plus, UserPlus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useToast } from "../app/providers";
import { Avatar } from "../components/Avatar";
import { PageHeader } from "../components/PageHeader";
import { previewUsers } from "../lib/fixtures";
import type { Role, User } from "../lib/types";

const roleLabels: Record<Role, string> = {
  REPORTER: "Reporter",
  SUPPORT_AGENT: "Support agent",
  ADMIN: "Administrator",
};

export function UsersPage() {
  const [users, setUsers] = useState<User[]>(previewUsers);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("REPORTER");
  const { showToast } = useToast();

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const user: User = {
      userId: crypto.randomUUID(),
      displayName: name.trim(),
      email: email.trim().toLowerCase(),
      role,
    };
    setUsers((current) => [...current, user]);
    setName("");
    setEmail("");
    setRole("REPORTER");
    setFormOpen(false);
    showToast(
      "User added to this local preview. Auth integration is pending.",
      "success",
    );
  }

  return (
    <div className="page-content page-enter">
      <PageHeader
        title="User management"
        description="Manage who can report issues, work the queue, and oversee the service desk."
        action={
          <button
            className="button button-primary"
            onClick={() => setFormOpen((current) => !current)}
            type="button"
          >
            {formOpen ? <X size={16} /> : <Plus size={17} />}
            {formOpen ? "Close form" : "Add user"}
          </button>
        }
      />

      {formOpen ? (
        <form className="inline-user-form" onSubmit={handleCreate}>
          <div className="inline-user-form-heading">
            <div>
              <h2>Provision an account</h2>
              <p>
                Accounts are created by an administrator; there is no public
                registration.
              </p>
            </div>
            <span className="inline-user-form-icon">
              <UserPlus size={19} />
            </span>
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label className="field-label" htmlFor="user-name">
                Full name
              </label>
              <input
                className="text-input"
                id="user-name"
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="user-email">
                Work email
              </label>
              <input
                className="text-input"
                id="user-email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </div>
            <div className="form-field">
              <label className="field-label" htmlFor="user-role">
                Role
              </label>
              <select
                className="text-input select-input"
                id="user-role"
                onChange={(event) => setRole(event.target.value as Role)}
                value={role}
              >
                <option value="REPORTER">Reporter</option>
                <option value="SUPPORT_AGENT">Support agent</option>
                <option value="ADMIN">Administrator</option>
              </select>
            </div>
          </div>
          <div className="inline-user-form-actions">
            <span className="field-helper">
              Preview only — this does not create an Auth account.
            </span>
            <button
              className="button button-primary"
              disabled={!name.trim() || !email.includes("@")}
              type="submit"
            >
              Add to preview
            </button>
          </div>
        </form>
      ) : null}

      <section className="queue-panel users-panel">
        <div className="queue-toolbar">
          <div className="queue-toolbar-copy">
            <strong>{users.length} accounts</strong>
            <span>Sample users in the local preview</span>
          </div>
          <span className="users-active-note">
            <span />
            All preview accounts active
          </span>
        </div>
        <div className="users-table-wrap">
          <table className="ticket-table users-table">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Role</th>
                <th scope="col">Email</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.userId}>
                  <td>
                    <div className="user-table-name">
                      <Avatar name={user.displayName} size="medium" />
                      <span>
                        <strong>{user.displayName}</strong>
                        <small>
                          {user.userId === "22222222-2222-4222-8222-222222222222"
                            ? "Current reporter"
                            : "Preview account"}
                        </small>
                      </span>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`role-label role-${user.role.toLowerCase().replaceAll("_", "-")}`}
                    >
                      {roleLabels[user.role]}
                    </span>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    <span className="account-status">
                      <i />
                      Active
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="workspace-footnote">
        User creation and account status are preview-only until the Auth service is
        connected.
      </p>
    </div>
  );
}
