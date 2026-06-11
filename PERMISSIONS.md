# Managing folder permissions

This guide explains how access control works in this SilverBullet fork and how to
manage it day to day. It covers enabling permissions, the three access levels,
how a rule is resolved for a given file and user, and the three ways to edit
rules (the admin panel, the REST API, and the raw JSON file).

## When permissions are active

Folder permissions only apply when authentication is configured. With no users
defined, the space is single-user and fully open — every rule is ignored.

You enable auth (and therefore permissions) by defining users at launch:

- `SB_USER="alice:<hash>"` — a single user.
- `SB_USERS="alice:<hash>,bob:<hash>"` — several users, comma-separated.

The **first** user listed becomes the **admin**. The admin is the only account
that can view or change permissions, and is seeded automatically with write
access to a virtual folder called `_admin`. Admin status is simply "has write on
`_admin`", so you can promote another user by granting them that.

### Password security

Each entry is `username:password`, where `password` should be a **bcrypt hash**,
not plaintext. Passwords are never stored in a recoverable form — the server
verifies them with bcrypt (a salted, one-way hash) and keeps only the hash in
memory.

Generate a hash with the bundled helper and paste the result into the env var:

    go run scripts/hash_password.go 'your-password'
    # → $2b$10$... ; then SB_USER="alice:$2b$10$..."

Plaintext (`alice:secret`) is *accepted* for convenience — it's hashed at startup
— but it's then sitting in cleartext in your launch script or environment, and
the server logs a warning. Prefer a hash so no recoverable password is ever
stored on disk. An entry is treated as already-hashed when it starts with `$2b$`
or `$2a$`.

> **Remote access needs TLS.** The login form sends the password to the server,
> and the server speaks plain HTTP — it even logs that it should run behind a TLS
> terminator. Bcrypt protects passwords *at rest*, not *in transit*. If you
> expose the instance beyond `localhost`, put it behind HTTPS (a reverse proxy
> such as Caddy, nginx, or Traefik) so credentials aren't sent in the clear.

## The three permission levels

Every rule grants one of three levels to a user on a folder:

- **write** — read, edit, create, and delete files in the folder.
- **read** — open and read files, but not modify or delete them.
- **none** — the folder and its files are hidden entirely: no read, no write, and
  they don't appear in the file list or search.

There is no separate "list" or "share" level; `none` hides, `read` reveals
read-only, `write` is full access.

## How a rule is resolved

When a user requests a file, the server walks the file's folder path from the
**most specific** folder to the **least specific**, looking for a matching rule.
At each folder that has a rule it checks, in order:

1. an entry for that exact username, then
2. a `*` wildcard entry (everyone not named).

If it finds either, that level wins. If the folder's rule covers neither, the
search **continues up to the parent folder** — so a parent rule is inherited
rather than shadowed by a more specific folder that happens to omit the user.

If no folder along the path has a matching rule, the **space-wide default**
applies (see below).

A worked example. Given these rules:

    Finance            → { alice: read }
    Finance/Reports    → { bob: write }

- `alice` opening `Finance/Reports/q1.md` gets **read** — `Finance/Reports` has a
  rule but doesn't mention her, so she inherits `Finance`.
- `bob` opening the same file gets **write** — his explicit rule on
  `Finance/Reports` wins.
- `carol` (named nowhere) gets the space default.

## The wildcard: making a folder private

The `*` wildcard is the key to private folders. To restrict `Finance` to Alice
and Bob only:

    Finance → { "*": "none", "alice": "write", "bob": "read" }

Everyone unnamed resolves to `none` via the wildcard; Alice and Bob get their
explicit levels. Without the wildcard, unnamed users would fall through to the
space default instead — which is open by default, so the folder would *not* be
private. Always pair a private folder with a `*` rule (or switch the space-wide
default to `none`; see next).

## The space-wide default

When no rule matches, the fallback is controlled by `SB_DEFAULT_PERMISSION`:

- unset or `write` — **open by default** (the original behavior). Anything not
  explicitly restricted is fully editable.
- `read` — everything is readable but only writable where a rule grants write.
- `none` — **deny by default** ("fail-closed"). Nothing is accessible unless a
  rule grants it. This is the strongest posture but requires you to grant access
  deliberately, folder by folder (ideally with a broad `*` rule near the root and
  exceptions below it).

Set it at launch, e.g. `SB_DEFAULT_PERMISSION=none`.

### System-path carve-out under deny-by-default

So the editor can still boot when the default is `none`, a few paths the client
must load are automatically granted **read** even with no rule:

- anything under `Library/` (the standard library, widgets, your space scripts),
- compiled plug files (`*.plug.js`),
- the top-level `SETTINGS.md`, `CONFIG.md`, and `index.md`.

This is only a fallback. An **explicit rule always overrides it** — so if you
genuinely want to restrict something under `Library/`, write a rule for it (for
example `Library → { "*": "none" }`) and the carve-out steps aside.

## Managing rules from the admin panel

Sign in as the admin and open the Permissions panel in the sidebar. From there
you can:

- See every folder rule, with the `_admin` (admin users) rule pinned at the top.
- Add a folder rule: enter a folder path and a username under "Add folder rule".
- Add users to an existing folder, each with a write/read/none level.
- Change a user's level with the dropdown, or remove a user, or remove the whole
  folder rule.
- Click **Make private** on a folder to insert a `* → none` rule in one step,
  then add the specific users who should have access. The wildcard row is shown
  as **"Everyone else"** and always sorts to the top of its folder.

Changes take effect immediately and are saved to disk.

## Managing rules via the REST API

The admin can script changes against `/.api/permissions` (admin auth required):

    # List all rules
    curl -u alice:secret http://localhost:3456/.api/permissions

    # Grant bob read on Finance
    curl -u alice:secret -X POST http://localhost:3456/.api/permissions \
      -H 'Content-Type: application/json' \
      -d '{"folder":"Finance","username":"bob","permission":"read"}'

    # Make Finance private to everyone else
    curl -u alice:secret -X POST http://localhost:3456/.api/permissions \
      -H 'Content-Type: application/json' \
      -d '{"folder":"Finance","username":"*","permission":"none"}'

    # Remove bob from Finance
    curl -u alice:secret -X DELETE http://localhost:3456/.api/permissions \
      -H 'Content-Type: application/json' \
      -d '{"folder":"Finance","username":"bob"}'

    # Remove the entire Finance rule
    curl -u alice:secret -X DELETE http://localhost:3456/.api/permissions \
      -H 'Content-Type: application/json' \
      -d '{"folder":"Finance"}'

`permission` must be exactly `write`, `read`, or `none`; anything else returns
HTTP 400. `username` may be `*` for the wildcard.

## Editing the JSON file directly

Rules live in `_permissions.json` at the root of your space (file mode 0600). It
is never served to clients and is hidden from file listings. The shape is
`folder → username → level`:

    {
      "_admin":  { "alice": "write" },
      "Finance": { "*": "none", "alice": "write", "bob": "read" },
      "Library": { "*": "none" }
    }

The file is read **once at startup**. If you edit it by hand, restart the server
to load the changes — edits made through the panel or API are applied and saved
live, so prefer those for running instances.

## Recipes

**A private folder for two people** — leave the space default open, and on the
folder set `{ "*": "none", "alice": "write", "bob": "read" }`.

**A read-only published folder** — `{ "*": "read" }`, plus `editor: write` for
whoever maintains it.

**A locked-down space** — launch with `SB_DEFAULT_PERMISSION=none`, then grant
each user the folders they need. The Library/config carve-out keeps the editor
working; add explicit `none` rules if you want to restrict even those.

## Troubleshooting

**The Permissions panel shows `Unexpected token '<' … is not valid JSON`.** The
service worker is serving the cached app shell instead of the API. Make sure the
client has been rebuilt with `/.api` in the proxy allow-list, then hard-refresh
(or run `Client: Wipe`).

**Under `SB_DEFAULT_PERMISSION=none`, the editor is broken for a user.** They
likely can't read something outside the carve-out (a plug, a script, a page the
client loads). Grant the needed path explicitly, or widen access with a `*` rule
near the root.

**Locked yourself out as admin.** Admin is "write on `_admin`". If that entry is
missing, stop the server, restore it in `_permissions.json`
(`"_admin": { "<you>": "write" }`), and restart.
