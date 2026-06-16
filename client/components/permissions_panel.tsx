import { useEffect, useState } from "preact/hooks";

type PermissionLevel = "write" | "read" | "none";

type FolderPerms = Record<string, Record<string, string>>;

async function apiFetch(
  method: string,
  body?: object,
): Promise<any> {
  const opts: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(new URL(".api/permissions", document.baseURI), opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

type Props = {
  currentUser: string;
};

export function PermissionsPanel({ currentUser }: Props) {
  const [perms, setPerms] = useState<FolderPerms>({});
  const [error, setError] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [newFolderUser, setNewFolderUser] = useState("");

  const load = async () => {
    try {
      const data = await apiFetch("GET");
      setPerms(data as FolderPerms);
      setError(null);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  useEffect(() => { void load(); }, []);

  const setPermission = async (folder: string, username: string, perm: PermissionLevel) => {
    try {
      await apiFetch("POST", { folder, username, permission: perm });
      await load();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const removeUser = async (folder: string, username: string) => {
    try {
      await apiFetch("DELETE", { folder, username });
      await load();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const removeFolder = async (folder: string) => {
    try {
      await apiFetch("DELETE", { folder });
      await load();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const addFolderWithUser = async () => {
    const folder = newFolder.trim();
    const username = newFolderUser.trim();
    if (!folder || !username) return;
    try {
      await apiFetch("POST", { folder, username, permission: "write" });
      setNewFolder("");
      setNewFolderUser("");
      await load();
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
  };

  const folders = Object.keys(perms).sort((a, b) => {
    if (a === "_admin") return -1;
    if (b === "_admin") return 1;
    return a.localeCompare(b);
  });

  // Friendly label for a username row; "*" is the wildcard covering everyone
  // not explicitly listed.
  const userLabel = (username: string) =>
    username === "*" ? "Everyone else" : username;

  // Sort so the "*" wildcard always renders first within a folder.
  const sortedUsers = (folder: string) =>
    Object.entries(perms[folder]).sort(([a], [b]) => {
      if (a === "*") return -1;
      if (b === "*") return 1;
      return a.localeCompare(b);
    });

  return (
    <div className="sb-permissions-panel">
      <div className="sb-nav-section-label">Permissions</div>
      {error && <div className="sb-permissions-error">{error}</div>}

      {folders.map((folder) => (
        <div key={folder} className="sb-permissions-folder">
          <div className="sb-permissions-folder-header">
            <span className="sb-permissions-folder-name">
              <i className={`ti ti-${folder === "_admin" ? "crown" : "folder"}`} />
              {folder === "_admin" ? " Admin users" : ` ${folder}`}
            </span>
            {folder !== "_admin" && (
              <button
                className="sb-permissions-remove-btn"
                title="Remove folder rule"
                onClick={() => void removeFolder(folder)}
              >
                <i className="ti ti-trash" />
              </button>
            )}
          </div>
          {sortedUsers(folder).map(([username, perm]) => (
            <div key={username} className="sb-permissions-user-row">
              <span
                className="sb-permissions-username"
                title={username === "*" ? "Applies to all users without their own rule" : username}
              >
                {username === "*" && <i className="ti ti-users" style={{ marginRight: "4px" }} />}
                {userLabel(username)}
              </span>
              <select
                className="sb-permissions-select"
                value={perm}
                onChange={(e) =>
                  void setPermission(folder, username, (e.target as HTMLSelectElement).value as PermissionLevel)
                }
              >
                <option value="write">Write</option>
                <option value="read">Read</option>
                {folder !== "_admin" && <option value="none">None</option>}
              </select>
              <button
                className="sb-permissions-remove-btn"
                title="Remove user"
                onClick={() => void removeUser(folder, username)}
              >
                <i className="ti ti-x" />
              </button>
            </div>
          ))}
          <AddUserRow
            isAdminFolder={folder === "_admin"}
            hasWildcard={Object.prototype.hasOwnProperty.call(perms[folder], "*")}
            onAdd={(username, perm) => void setPermission(folder, username, perm)}
          />
        </div>
      ))}

      <div className="sb-permissions-add-folder">
        <div className="sb-nav-section-label" style={{ marginTop: "12px" }}>Add folder rule</div>
        <input
          className="sb-permissions-input"
          placeholder="Folder path (e.g. Private)"
          value={newFolder}
          onInput={(e) => setNewFolder((e.target as HTMLInputElement).value)}
        />
        <input
          className="sb-permissions-input"
          placeholder="Username"
          value={newFolderUser}
          onInput={(e) => setNewFolderUser((e.target as HTMLInputElement).value)}
        />
        <button
          className="sb-permissions-add-btn"
          onClick={() => void addFolderWithUser()}
          disabled={!newFolder.trim() || !newFolderUser.trim()}
        >
          Add folder
        </button>
      </div>
    </div>
  );
}

function AddUserRow(
  { onAdd, hasWildcard, isAdminFolder }: {
    onAdd: (username: string, perm: PermissionLevel) => void;
    hasWildcard: boolean;
    isAdminFolder: boolean;
  },
) {
  const [username, setUsername] = useState("");
  const [perm, setPerm] = useState<PermissionLevel>("write");

  const submit = () => {
    if (!username.trim()) return;
    onAdd(username.trim(), perm);
    setUsername("");
    setPerm("write");
  };

  return (
    <div className="sb-permissions-add-user">
      <input
        className="sb-permissions-input sb-permissions-input-sm"
        placeholder="Add user (or * for everyone)…"
        value={username}
        onInput={(e) => setUsername((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
      />
      <select
        className="sb-permissions-select"
        value={perm}
        onChange={(e) => setPerm((e.target as HTMLSelectElement).value as PermissionLevel)}
      >
        <option value="write">Write</option>
        <option value="read">Read</option>
        {!isAdminFolder && <option value="none">None</option>}
      </select>
      <button
        className="sb-permissions-add-btn"
        onClick={submit}
        disabled={!username.trim()}
      >
        <i className="ti ti-plus" />
      </button>
      {!hasWildcard && !isAdminFolder && (
        <button
          className="sb-permissions-add-btn"
          title="Make private: deny everyone else, then grant specific users"
          onClick={() => onAdd("*", "none")}
        >
          <i className="ti ti-lock" /> Make private
        </button>
      )}
    </div>
  );
}
