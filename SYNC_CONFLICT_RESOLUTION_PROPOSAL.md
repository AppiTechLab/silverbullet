# Proposal: Improving Sync Conflict Resolution in SilverBullet

_Status: Draft for review — June 15, 2026_

## 1. Summary

SilverBullet's sync currently resolves conflicts with a hard **"primary wins"**
rule: when the same file changed on both the local space (primary) and the
remote space (secondary) since the last sync, the local version overwrites the
remote, and the remote's version is preserved only as a `.conflicted:<timestamp>`
copy that the user must reconcile by hand. There is no content-level merging,
and the only user-facing signal is a transient flash notification.

This document proposes adding **three-way text merging** for Markdown/text files,
so that non-overlapping edits made on two devices merge cleanly and silently,
and only genuinely overlapping edits fall back to a conflict artifact — which we
also propose to surface more usefully. Binary files keep the existing
last-writer-wins behavior.

The change is deliberately scoped to be **opt-in and pluggable**: the merge
strategy slots into the existing `conflictResolver` hook, so the current
behavior remains the default until the new path is proven.

## 2. How conflict resolution works today

The relevant code lives in three places:

- `client/spaces/sync.ts` — the core `SpaceSync` algorithm and the static
  `primaryConflictResolver`.
- `client/service_worker/sync_engine.ts` — `SyncEngine`, which wraps `SpaceSync`,
  persists the snapshot, runs the 20-second sync loop, and supplies the
  `stdLibAwareConflictResolver`.
- `plugs/sync/sync.ts` — `reportSyncConflict`, which shows the flash
  notification, wired through `client/service_worker.ts`.

### The detection path

`SpaceSync.syncFile` decides per file what to do based on three inputs: the
primary metadata, the secondary metadata, and the last-synced snapshot entry.
The snapshot stores, per path, a tuple of two `lastModified` timestamps:

```ts
// client/spaces/sync.ts
type SyncHash = number; // a lastModified timestamp
export type SyncStatusItem = [SyncHash, SyncHash]; // [primary, secondary]
```

A conflict is declared when **both** sides have changed relative to the snapshot
(or when there is no snapshot entry but both sides have the file), at which point
`syncFile` calls `this.options.conflictResolver(...)`. There is also a
defensive branch that forces conflict resolution when timestamps match but
file sizes differ (a "silent content change").

### The resolution path

`SpaceSync.primaryConflictResolver` then:

1. Reads both versions and does a byte-wise comparison. If identical, it records
   the snapshot and exits with zero operations (a "fake" conflict).
2. If they differ, it writes a `.conflicted:<secondary.lastModified>` copy
   (containing the **secondary**'s content) to **both** spaces, then overwrites
   the canonical path with the **primary**'s content.

`SyncEngine.stdLibAwareConflictResolver` wraps this: for standard-library plug
files it unconditionally takes the secondary version; for everything else it
delegates to `primaryConflictResolver` and, if a conflict copy was created,
emits a `syncConflict` event that becomes the flash notification.

## 3. Limitations

1. **No content merging.** Two devices editing *different* paragraphs of the
   same note still produce a conflict; one device's edits are silently demoted
   to a `.conflicted:` file. For a notes app where the same page is edited across
   phone and desktop, this is the most common and most painful case.

2. **"Primary wins" is positional, not semantic.** The winner is whichever space
   happens to be configured as local — not the most recent edit, not the larger
   edit, not the user's intent.

3. **Conflict copies are unstructured clutter.** A `.conflicted:1718...` file is
   a plain page that shows up in the page list and index. There is no view that
   lists outstanding conflicts, no diff, and no one-click "keep mine / keep
   theirs / merge". The only signal is a flash notification that disappears.

4. **No common ancestor is retained.** The snapshot stores only timestamps, so
   even if we wanted to merge, there is currently no base version to merge
   against. This is the key structural gap that any merge feature must close.

5. **Timestamp-named copies can collide.** Two conflicts on the same file
   resolved within the same millisecond would map to the same
   `.conflicted:<ts>` name.

## 4. Proposed approach

### 4.1 Retain a merge base (prerequisite)

Three-way merge needs the last-synced content (the common ancestor), not just
its timestamp. Two options:

- **(A) Store a base blob in local KV.** When `syncFile` successfully syncs a
  text file, also persist its bytes in IndexedDB under a `["$sync","base",path]`
  key. Cost: roughly doubles local storage for synced text. Simple and reliable.
- **(B) Store only a content hash; reconstruct base on demand.** Lower storage,
  but the base often cannot be reconstructed (that is the whole problem), so this
  only helps detect fake conflicts faster. Not sufficient for merging on its own.

**Recommendation: Option A, limited to text files** (`.md` and other text MIME
types), with a size cap (e.g. skip bases above a few hundred KB) to bound
storage. Binary and oversized files simply have no base and fall back to the
current resolver.

### 4.2 A three-way merge resolver

Add a new `mergeConflictResolver` that conforms to the existing `conflictResolver`
signature, so it drops into `SyncEngine` without touching the `SpaceSync`
algorithm:

1. If the file is not text, or no base is available → delegate to the existing
   `primaryConflictResolver` (unchanged behavior).
2. Otherwise run a line-based **diff3** merge of `(primary, base, secondary)`.
   - **Clean merge** (no overlapping hunks): write the merged result to both
     spaces, update the snapshot and the stored base, emit *no* conflict. This is
     the win — cross-device edits to different parts of a note just work.
   - **Overlapping hunks**: choose one of two fallbacks (configurable):
     - *Conflict copy* (today's behavior) — safe, never corrupts the page.
     - *Inline markers* — write Git-style `<<<<<<<`/`=======`/`>>>>>>>` markers
       into the page so the user resolves in place. Higher UX payoff but must be
       handled carefully (see risks).

diff3 is small and well-understood; a vetted dependency (e.g. `node-diff3`) or a
~150-line vendored implementation avoids reinventing it.

### 4.3 Better conflict surfacing

Independently of merging, replace the disappearing flash with something durable:

- A **Conflicts page/view** (a Space Lua / query-backed page) that lists every
  outstanding `.conflicted:` artifact with links to both versions.
- Optionally, a lightweight diff widget and "keep this version" action so a
  conflict can be resolved without leaving SilverBullet.

This is valuable even if 3-way merge is deferred, and it is lower-risk.

## 5. Trade-offs and risks

- **Storage:** retaining bases for text roughly doubles local storage for synced
  text content. Bounded by the text-only + size-cap rules above.
- **Semantically wrong clean merges:** diff3 can produce a syntactically clean
  but semantically broken result (e.g. merging two edits to the same Markdown
  table or to YAML frontmatter). Mitigations: treat frontmatter as an atomic
  block that conflicts rather than merges; prefer conflict markers/copies when a
  hunk touches structured regions.
- **Inline markers vs. the editor:** conflict markers must not corrupt
  live-preview rendering or Space Lua parsing. If we adopt inline markers, they
  should be validated against the editor and ideally rendered by a dedicated
  widget; otherwise default to the safer conflict-copy fallback.
- **Backward compatibility:** snapshots created before this change have no
  bases. The resolver must treat "no base" as "fall back to primary-wins", so
  existing installs degrade gracefully and self-heal as files re-sync.

## 6. Suggested implementation outline

1. **Snapshot/base storage** — extend `SyncEngine` (and the snapshot save/load in
   `client/service_worker/sync_engine.ts`) to read/write per-path base blobs in
   KV; populate the base on every successful text-file sync in
   `SpaceSync.syncFile`.
2. **Merge resolver** — add `mergeConflictResolver` (new module, e.g.
   `client/spaces/merge.ts`) implementing the diff3 logic, with the
   text-detection + size-cap guards and a config flag for the overlap fallback.
3. **Wire it in** — in `SyncEngine.start`, select `mergeConflictResolver` when
   enabled, still wrapping it with the stdLib-aware behavior; keep
   `primaryConflictResolver` as the default.
4. **Config** — add a sync setting (alongside `syncDocuments` / `syncIgnore` in
   `SyncConfig`) such as `conflictStrategy: "primary" | "merge"` and
   `mergeFallback: "copy" | "markers"`.
5. **Tests** — extend `client/spaces/sync.test.ts` with: clean non-overlapping
   merge (no conflict copy), overlapping merge (copy or markers), no-base
   fallback, binary fallback, and frontmatter-atomic behavior.
6. **Surfacing** — add the Conflicts view and (optionally) the resolve widget;
   improve `reportSyncConflict` to point at it instead of a transient toast.

## 7. Recommended sequencing

- **Phase 1 (low risk, high value):** the Conflicts view + improved surfacing.
  No algorithm changes; immediately makes today's conflicts manageable.
- **Phase 2:** base-blob retention + diff3 with the **conflict-copy fallback**.
  Delivers silent merges for the common case while never corrupting a page.
- **Phase 3 (optional):** inline-marker fallback and in-editor resolution, once
  editor integration is validated.

## 8. Open questions

- Should merge be on by default once stable, or remain opt-in per space?
- For the overlap case, do you prefer inline Git-style markers or keeping the
  conflict-copy artifact?
- Is doubling local storage for text bases acceptable, or should there be a
  global cap / LRU eviction for bases?
