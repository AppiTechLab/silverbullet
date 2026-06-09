# Permissions, access control, and GitLab sync

Multi-user access control for a SilverBullet space. Most of the system is
**already implemented** in the server. This prompt covers the one missing piece
plus configuration and the GitLab sync script.

## What already exists

| Component | File | Status |
|---|---|---|
| Folder-level permission store | `server/permissions.go` | ✅ done |
| Enforcement at read/write/list | `server/fs.go` | ✅ done |
| REST admin API (`/.api/permissions`) | `server/server.go` | ✅ done |
| User auth with bcrypt | `server/multi_auth.go` | ✅ done |
| Admin UI panel in sidebar | `client/components/permissions_panel.tsx` | ✅ done |

The sidebar requires **no changes** — it renders `viewState.allPages`, which the
server already filters by permission before sending to the client.

---

## Part 1 — Add `"*"` wildcard support (Go, 3-line change)

Currently `GetFolderPermission` in `server/permissions.go` only checks exact
username matches. Without a wildcard, you cannot mark a folder as private to one
user without enumerating every other user with `"none"`.

Locate the inner block inside `GetFolderPermission` that reads:

```go
if folderPerms, ok := sp.store[folder]; ok {
    if perm, ok := folderPerms[username]; ok {
        return Permission(perm)
    }
    // Folder rule exists but user not listed → open default.
    return DefaultPermission
}
```

Replace it with:

```go
if folderPerms, ok := sp.store[folder]; ok {
    if perm, ok := folderPerms[username]; ok {
        return Permission(perm)
    }
    // Wildcard: applies to all unlisted users in this folder.
    if perm, ok := folderPerms["*"]; ok {
        return Permission(perm)
    }
    // Folder rule exists but user not listed → open default.
    return DefaultPermission
}
```

This is the only server change required.

---

## Part 2 — `_permissions.json` format

Place this file in the **space root** (same directory as your markdown files).

```json
{
  "_admin": {
    "antoine": "write"
  },
  "Projects/BioSensor": {
    "antoine": "write",
    "alice":   "write",
    "*":       "none"
  },
  "Acquisition/ERC-2027": {
    "antoine": "write",
    "*":       "none"
  },
  "Lab/Protocols": {
    "*": "write"
  },
  "Personal": {
    "antoine": "write",
    "*":       "none"
  }
}
```

### Permission levels

| Entry | Meaning |
|---|---|
| `"username": "write"` | Named user can read and write |
| `"username": "read"` | Named user can read, not write |
| `"username": "none"` | Named user cannot see the folder at all |
| `"*": "write"` | All unlisted users can read and write — **marks folder for GitLab sync** |
| `"*": "read"` | All unlisted users can read only |
| `"*": "none"` | All unlisted users are denied — folder is private |

### How permission lookup works

1. Find the longest prefix of the file path that has a rule.  
   (`Projects/BioSensor/results.md` → tries `Projects/BioSensor`, then `Projects`)
2. Within that rule: specific user → `"*"` wildcard → `DefaultPermission` (write).
3. No matching prefix → `DefaultPermission` (write) — fully open.

### Root folder visibility

Do **not** add rules for top-level folders (`Projects`, `Acquisition`, etc.).
Without a rule, they default to open — everyone can see the folder exists and
browse it. Restrictions live on the subfolders where the sensitive content is.

### Reloading

The server reads `_permissions.json` at startup and whenever the file changes on
disk (via the `Save()` path through the admin API). To apply a manual edit to the
JSON file: restart the server, or trigger any write through the admin UI, which
will reload the store.

---

## Part 3 — Admin UI (no changes needed)

The lock icon at the bottom of the sidebar rail opens `PermissionsPanel`. It
is admin-only — visible only when `isAdmin` is true for the current user.

From the panel you can:
- View all folder rules
- Add a user/permission to any folder
- Remove a user, or remove an entire folder rule

The panel talks directly to `/.api/permissions` (GET / POST / DELETE). Changes
are written to `_permissions.json` immediately.

The `_admin` entry in `_permissions.json` controls who is admin. The first admin
is set from the `SB_USER` / `SB_USERS` environment variable at server startup.

### Adding users

Users are configured with environment variables, for example:

```
SB_USERS=antoine:$2b$12$...,alice:plaintext-password
```

Bcrypt hashes are recommended for production. Generate one:

```powershell
# PowerShell — needs bcrypt module or use a generator
# or run the server once with plaintext; it will log the hash to stdout
```

---

## Part 4 — GitLab sync script

The convention: any folder with a `"*"` key in `_permissions.json` is a
**public folder** and should be mirrored to the GitLab wiki.

### `scripts/Sync-ToGitLab.ps1`

```powershell
# Sync-ToGitLab.ps1
# Pushes all public SilverBullet folders (those with a "*" permission entry)
# to a GitLab wiki repository.
#
# Usage:
#   $env:GITLAB_TOKEN = "glpat-xxxxxxxxxxxxxxxxxxxx"
#   .\scripts\Sync-ToGitLab.ps1 -WikiUrl "https://gitlab.com/OWNER/PROJECT.wiki.git"
#
param(
    [string]$SpacePath    = (Join-Path $PSScriptRoot ".."),
    [string]$WikiUrl      = "https://gitlab.com/OWNER/PROJECT.wiki.git",
    [string]$Token        = $env:GITLAB_TOKEN,
    [string]$AuthorName   = "SilverBullet Sync",
    [string]$AuthorEmail  = "sync@silverbullet.local"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Validate inputs ────────────────────────────────────────────────────────────
$SpacePath = Resolve-Path $SpacePath
$permFile  = Join-Path $SpacePath "_permissions.json"

if (-not (Test-Path $permFile)) {
    Write-Error "_permissions.json not found at: $permFile"
    exit 1
}
if (-not $Token) {
    Write-Error "GITLAB_TOKEN not set. Run: `$env:GITLAB_TOKEN = 'glpat-...'"
    exit 1
}

# ── Find public folders ────────────────────────────────────────────────────────
$perms = Get-Content $permFile -Raw | ConvertFrom-Json

$publicFolders = @()
foreach ($prop in $perms.PSObject.Properties) {
    if ($prop.Name -eq "_admin") { continue }
    $users = $prop.Value.PSObject.Properties.Name
    if ($users -contains "*") {
        $publicFolders += $prop.Name
    }
}

if ($publicFolders.Count -eq 0) {
    Write-Host "No public folders found (no '*' key in _permissions.json). Nothing to sync."
    exit 0
}

Write-Host "Public folders to sync: $($publicFolders -join ', ')"

# ── Clone or update wiki repo ──────────────────────────────────────────────────
$wikiDir  = Join-Path ([System.IO.Path]::GetTempPath()) "sb-wiki-sync"
$authUrl  = $WikiUrl -replace "^https://", "https://oauth2:$Token@"

if (Test-Path (Join-Path $wikiDir ".git")) {
    Write-Host "Pulling latest wiki..."
    git -C $wikiDir fetch --quiet origin
    $branch = git -C $wikiDir symbolic-ref --short HEAD 2>$null
    if (-not $branch) { $branch = "main" }
    git -C $wikiDir reset --hard "origin/$branch" --quiet
} else {
    Write-Host "Cloning wiki..."
    git clone --quiet $authUrl $wikiDir
}

# ── Clear old synced content (preserve .git) ─────────────────────────────────
Get-ChildItem $wikiDir -Exclude ".git" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# ── Copy public folder contents ────────────────────────────────────────────────
foreach ($folder in $publicFolders) {
    $src = Join-Path $SpacePath $folder
    if (-not (Test-Path $src)) {
        Write-Warning "  Skipping '$folder': not found on disk."
        continue
    }
    $dst = Join-Path $wikiDir $folder
    New-Item -ItemType Directory -Path $dst -Force | Out-Null
    Copy-Item -Path (Join-Path $src "*") -Destination $dst -Recurse -Force
    Write-Host "  Copied: $folder"
}

# ── Commit and push ───────────────────────────────────────────────────────────
$env:GIT_AUTHOR_NAME     = $AuthorName
$env:GIT_AUTHOR_EMAIL    = $AuthorEmail
$env:GIT_COMMITTER_NAME  = $AuthorName
$env:GIT_COMMITTER_EMAIL = $AuthorEmail

git -C $wikiDir add --all --quiet

$changed = git -C $wikiDir status --porcelain
if (-not $changed) {
    Write-Host "No changes — wiki is already up to date."
    exit 0
}

$ts = Get-Date -Format "yyyy-MM-dd HH:mm"
git -C $wikiDir commit -m "Sync from SilverBullet [$ts]" --quiet

$branch = git -C $wikiDir symbolic-ref --short HEAD 2>$null
if (-not $branch) { $branch = "main" }
git -C $wikiDir push $authUrl "HEAD:$branch" --quiet

Write-Host "Done. Wiki synced successfully."
```

### One-time setup

```powershell
# Store your token (add to $PROFILE to persist)
$env:GITLAB_TOKEN = "glpat-xxxxxxxxxxxxxxxxxxxx"

# Test run
.\scripts\Sync-ToGitLab.ps1 `
    -WikiUrl "https://gitlab.com/yourlab/yourproject.wiki.git"
```

### Automate with Windows Task Scheduler

```powershell
$scriptPath = "C:\path\to\silverbullet\scripts\Sync-ToGitLab.ps1"
$wikiUrl    = "https://gitlab.com/yourlab/yourproject.wiki.git"

$action = New-ScheduledTaskAction `
    -Execute "pwsh.exe" `
    -Argument "-NonInteractive -File `"$scriptPath`" -WikiUrl `"$wikiUrl`""

# Also set GITLAB_TOKEN in the task's environment or pass via -Token parameter
$trigger = New-ScheduledTaskTrigger -Daily -At "02:00"

Register-ScheduledTask `
    -TaskName "SilverBullet GitLab Sync" `
    -Action   $action `
    -Trigger  $trigger `
    -RunLevel Highest
```

---

## Summary

| What | Action required |
|---|---|
| Add `"*"` wildcard to `GetFolderPermission` | 3-line edit in `server/permissions.go` |
| Create `_permissions.json` in space root | Copy and edit the example above |
| Sidebar auto-filtering | Nothing — already works |
| Admin UI | Nothing — already works, use lock icon in rail |
| GitLab sync | Create `scripts/Sync-ToGitLab.ps1`, run manually or schedule |
