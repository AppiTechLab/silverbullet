import { useEffect, useState } from "preact/hooks";

type User = {
  username: string;
  disabled: boolean;
  admin: boolean;
  created?: string;
};

async function apiFetch(method: string, body?: object): Promise<any> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(new URL(".api/users", document.baseURI), opts);
  if (!res.ok) throw new Error(await res.text());
  // DELETE/POST return a small JSON status; GET returns the list.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

type Props = {
  currentUser: string;
};

export function UsersPanel({ currentUser }: Props) {
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newAdmin, setNewAdmin] = useState(false);

  const load = async () => {
    try {
      const data = await apiFetch("GET");
      setUsers((data ?? []) as User[]);
      setError(null);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const createUser = () => {
    const username = newName.trim();
    if (!username || !newPass) return;
    void run(async () => {
      await apiFetch("POST", {
        action: "create",
        username,
        password: newPass,
        value: newAdmin,
      });
      setNewName("");
      setNewPass("");
      setNewAdmin(false);
    });
  };

  const resetPassword = (username: string) => {
    const pw = prompt(`New password for ${username}:`);
    if (!pw) return;
    void run(() =>
      apiFetch("POST", { action: "setPassword", username, password: pw })
    );
  };

  const toggleDisabled = (u: User) =>
    void run(() =>
      apiFetch("POST", {
        action: "setDisabled",
        username: u.username,
        value: !u.disabled,
      })
    );

  const toggleAdmin = (u: User) =>
    void run(() =>
      apiFetch("POST", {
        action: "setAdmin",
        username: u.username,
        value: !u.admin,
      })
    );

  const removeUser = (username: string) => {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    void run(() => apiFetch("DELETE", { username }));
  };

  return (
    <div className="sb-permissions-panel">
      <div className="sb-nav-section-label">Users</div>
      {error && <div className="sb-permissions-error">{error}</div>}

      {users.map((u) => (
        <div key={u.username} className="sb-permissions-folder">
          <div className="sb-permissions-user-row">
            <span
              className="sb-permissions-username"
              title={u.created ? `Created ${u.created}` : u.username}
            >
              <i
                className={`ti ti-${u.admin ? "crown" : "user"}`}
                style={{ marginRight: "4px" }}
              />
              {u.username}
              {u.username === currentUser && " (you)"}
              {u.disabled && (
                <span className="sb-user-badge sb-user-badge-disabled">
                  disabled
                </span>
              )}
            </span>
            <button
              className="sb-permissions-remove-btn"
              title="Delete user"
              onClick={() => removeUser(u.username)}
            >
              <i className="ti ti-trash" />
            </button>
          </div>
          <div className="sb-user-actions">
            <button
              className="sb-permissions-add-btn"
              title="Reset password"
              onClick={() => resetPassword(u.username)}
            >
              <i className="ti ti-key" /> Password
            </button>
            <button
              className="sb-permissions-add-btn"
              title={u.admin ? "Revoke admin" : "Grant admin"}
              onClick={() => toggleAdmin(u)}
            >
              <i className={`ti ti-${u.admin ? "shield-off" : "shield"}`} />
              {u.admin ? " Revoke admin" : " Make admin"}
            </button>
            <button
              className="sb-permissions-add-btn"
              title={u.disabled ? "Enable account" : "Disable account"}
              onClick={() => toggleDisabled(u)}
            >
              <i className={`ti ti-${u.disabled ? "user-check" : "user-off"}`} />
              {u.disabled ? " Enable" : " Disable"}
            </button>
          </div>
        </div>
      ))}

      <div className="sb-permissions-add-folder">
        <div className="sb-nav-section-label" style={{ marginTop: "12px" }}>
          Add user
        </div>
        <input
          className="sb-permissions-input"
          placeholder="Username"
          value={newName}
          onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
        />
        <input
          className="sb-permissions-input"
          type="password"
          placeholder="Password"
          value={newPass}
          onInput={(e) => setNewPass((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") createUser();
          }}
        />
        <label className="sb-user-admin-check">
          <input
            type="checkbox"
            checked={newAdmin}
            onChange={(e) => setNewAdmin((e.target as HTMLInputElement).checked)}
          />
          {" "}Admin
        </label>
        <button
          className="sb-permissions-add-btn"
          onClick={createUser}
          disabled={!newName.trim() || !newPass}
        >
          Create user
        </button>
      </div>
    </div>
  );
}
