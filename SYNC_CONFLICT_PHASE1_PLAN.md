# Phase 1 Implementation Plan: Surfacing Sync Conflicts

_Status: Detailed plan for review — June 15, 2026_

## Goal

Make sync conflicts **durable and discoverable** without touching the sync
algorithm. Two deliverables:

1. A **dedicated built-in Conflicts page** that lists every conflict copy with
   links to both the conflict copy and its original, plus timestamps.
2. An **actionable notification** that points the user to that page instead of a
   transient toast that disappears.

Scope intentionally excludes content merging and inline "keep mine / keep
theirs" resolve buttons (those are Phase 2+ / optional follow-ups noted at the
end). No Go/server changes; this is entirely client libraries + the sync plug.

## What exists today (baseline)

- Conflict copies are named `<base>.conflicted:<secondaryLastModified>.<ext>`
  (or `<path>.conflicted:<ts>` when there's no extension), created by
  `SpaceSync.primaryConflictResolver` in `client/spaces/sync.ts`.
- `libraries/Library/Std/Pages/Maintenance.md` already has a **"Conflicting
  copies"** section: a SLIQ query over `index.pages()` filtered by
  `p.name:find("%.conflicted:")`, listing the copy and a link back to the
  original. This is the seed we build on.
- `plugs/sync/sync.ts` → `reportSyncConflict` shows a one-off
  `editor.flashNotification(..., "error")`, wired via the
  `service-worker:sync-conflict` event in `plugs/sync/sync.plug.yaml`.

Key API facts confirmed in the codebase:

- `index.pages()` / `index.documents()` return objects whose meta includes
  `name`, `created`, and `lastModified` (see `plug-api/types/index.ts`).
- `editor.navigate(ref, ...)` exists (`plug-api/syscalls/editor.ts`) and is the
  mechanism for jumping to a page from a command.
- `editor.flashNotification(message, type)` takes **plain text only** — it is
  **not clickable** and does not render links. This constrains how "actionable"
  the toast itself can be (see design note below).

## Deliverable 1 — Dedicated Conflicts page

**New file:** `libraries/Library/Std/Pages/Conflicts.md`

Modeled on `Maintenance.md` and `Space Overview.md` (same `#meta` tag, same
`query[[ ... ]]` + `template.new[==[ ... ]==]` rendering pattern). Contents:

- A short intro explaining what a conflict copy is and how to resolve it
  (compare the two versions, keep the right content, delete the copy).
- A **count / empty-state** line so an empty page reads "No conflicts — all in
  sync!" (reuse the `some(query[[...]]) or "..."` idiom already used in
  Maintenance).
- A **conflicting pages** section querying `index.pages()` where
  `name:find("%.conflicted:")`, rendering for each row:
  - link to the **original** page: `name:gsub("%.conflicted:.+$", "")`
  - link to the **conflict copy**: `name`
  - the conflict copy's `lastModified` (and, if cleanly extractable, the
    `:<timestamp>` parsed from the filename for the remote edit time).
- A **conflicting documents** section doing the same over `index.documents()`,
  so binary/non-markdown conflicts are not invisible.

Sketch of the page query (to be refined against SLIQ during implementation):

```markdown
#meta

Pages with conflicting copies from sync. For each, open both versions, decide
which content to keep, then delete the `.conflicted:` copy.

# Conflicting pages
${some(query[[
  from p = index.pages()
  where p.name:find("%.conflicted:")
  order by p.lastModified desc
  select template.new[==[
    * [[${name:gsub("%.conflicted:.+$", "")}]] — conflict copy: [[${name}]] (modified ${lastModified})
  ]==](p)
]]) or "No conflicting pages — all in sync!"}

# Conflicting documents
${some(query[[
  from d = index.documents()
  where d.name:find("%.conflicted:")
  order by d.lastModified desc
  select template.new[==[
    * conflict copy: [[${name}]] (modified ${lastModified})
  ]==](d)
]]) or "No conflicting documents."}
```

**Edit:** trim the "Conflicting copies" section in
`libraries/Library/Std/Pages/Maintenance.md` to a one-line pointer
(`See [[^Library/Std/Pages/Conflicts]]`) so the two pages don't drift, per the
"dedicated page" choice.

## Deliverable 2 — Actionable notification

**Design note / constraint:** `flashNotification` is plain text and not
clickable, so "link to conflicts view" is delivered as a **named command the
user can run from anywhere** plus a notification that names it. This is the
faithful, low-risk way to make the conflict actionable within current APIs.

Changes in `plugs/sync/sync.ts`:

- Add a command function:

  ```ts
  export async function showConflictsCommand() {
    await editor.navigate({ kind: "page", page: "Library/Std/Pages/Conflicts" });
  }
  ```

  (Exact `ref` shape to match how other built-in commands call
  `editor.navigate`; verify against an existing caller during implementation.)

- Update `reportSyncConflict` so the message tells the user where to go, e.g.:

  ```ts
  await editor.flashNotification(
    `Sync conflict for ${path} — a conflict copy was created. ` +
      `Run "Sync: Show Conflicts" to review.`,
    "error",
  );
  ```

Changes in `plugs/sync/sync.plug.yaml`:

- Register the new command alongside the existing `Sync: Space` / `Sync: File`:

  ```yaml
  showConflictsCommand:
    path: "./sync.ts:showConflictsCommand"
    command:
      name: "Sync: Show Conflicts"
      menu:
        location: space
        group: "1_sync"
        order: 3
        label: "Show Conflicts"
  ```

This keeps the toast (immediate awareness) but adds a discoverable, repeatable
path to the durable list — which survives long after the toast is gone.

## Files touched

| File | Change |
|------|--------|
| `libraries/Library/Std/Pages/Conflicts.md` | **New** dedicated page (queries + intro). |
| `libraries/Library/Std/Pages/Maintenance.md` | Replace inline conflict section with a pointer to the new page. |
| `plugs/sync/sync.ts` | Add `showConflictsCommand`; reword `reportSyncConflict`. |
| `plugs/sync/sync.plug.yaml` | Register `Sync: Show Conflicts` command. |

## Testing & verification

- **Manual:** create a conflict (edit the same page on two clients / simulate by
  writing a `*.conflicted:<ts>.md` file), confirm it appears on the Conflicts
  page with working links to both versions, the empty state shows when none
  exist, and `Sync: Show Conflicts` navigates correctly.
- **Notification:** trigger `service-worker:sync-conflict` and confirm the
  reworded toast appears and references the command.
- **Plug build:** rebuild plugs (the repo's plug compile step) so the new
  command function and YAML are bundled; confirm no TypeScript errors in
  `plugs/sync/sync.ts`.
- **Regression:** existing `client/spaces/sync.test.ts` is unaffected (no
  algorithm change) and should still pass — run it to confirm.
- **SLIQ check:** validate the `gsub`/`find` patterns and `order by` against the
  SLIQ reference (`libraries/Library/Std/Docs/SLIQ Reference.md`) since the
  query is the part most likely to need syntax tweaks.

## Risks & notes

- **Low risk overall:** no changes to the sync algorithm, snapshot format, or Go
  server. Worst case is a malformed query on one built-in page.
- The conflict-copy **timestamp in the filename is the remote `lastModified`**,
  not a wall-clock the user chose; present it as "remote version time" to avoid
  confusion.
- `flashNotification` can't be a hyperlink today; if a clickable toast is later
  desired, that's a small client-side enhancement (out of Phase 1 scope).

## Optional follow-ups (not in this phase)

- Inline **resolve actions** on the Conflicts page ("keep original / keep copy /
  delete copy") via action buttons or a Lua command — natural Phase 1.5.
- A **persistent indicator/count** (e.g. in a panel or status area) that stays
  until conflicts are cleared, rather than relying on the toast.
