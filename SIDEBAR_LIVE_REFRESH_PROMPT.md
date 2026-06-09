# Sidebar: live page-list refresh on filesystem changes

The sidebar (pages, categories, folder counts) only updates on initial load and
when the user opens the page navigator. Two code paths are broken:

1. **In-app create / save / delete** — `page:saved` and `page:deleted` events
   fire but nothing calls `updatePageListCache()` in response.
2. **External changes** (GitLab sync, another user, file manager) — the 10-second
   poll detects the change, indexes it, but the `mq:emptyQueue:indexQueue`
   listener that calls `updatePageListCache()` is **gated by
   `widgetReadyDispatched`**, so it is a no-op after initial load.

The fix is two additions in `client/client.ts`. No other files need changes.

---

## Root cause detail

In `client/client.ts`, `updatePageListCache()` is called on startup and on a
few explicit triggers (page navigator open, full re-index). The relevant
listener that *should* keep it current is:

```ts
// EXISTING — currently a no-op after initial load
this.eventHook.addLocalListener("mq:emptyQueue:indexQueue", async () => {
  if (this.widgetReadyDispatched) return;   // ← exits immediately every time
  if (!this.pageListLoaded && ...) {
    await this.updatePageListCache();
  }
});
```

`widgetReadyDispatched` is set to `true` once widgets are first rendered, so
this block never runs again. External file changes get indexed but the sidebar
never reflects them.

`page:saved` and `page:deleted` (fired by `evented_space_primitives.ts`) have
no listener that refreshes the page list at all.

---

## Fix — two additions in `client/client.ts`

Locate the block that registers the `file:changed`, `file:deleted`, and
`file:listed` listeners (around line 442). Add the following two listeners
**in the same block**:

```ts
// ── Sidebar live refresh ──────────────────────────────────────────────────────

// 1. Immediate refresh when a page is created or saved within the app.
//    page:saved fires from evented_space_primitives.writeFile() for every
//    .md write, including new pages created via the sidebar + button or
//    wiki-link navigation.
this.eventHook.addLocalListener("page:saved", () => {
  this.updatePageListCache().catch(console.error);
});

// 2. Immediate refresh when a page is deleted within the app.
//    page:deleted fires from evented_space_primitives.deleteFile().
this.eventHook.addLocalListener("page:deleted", () => {
  this.updatePageListCache().catch(console.error);
});
```

Then locate the **existing** `mq:emptyQueue:indexQueue` listener and remove
the early-return guard so external changes also refresh the sidebar after
re-indexing:

```ts
// EXISTING listener — find this block and edit it
this.eventHook.addLocalListener("mq:emptyQueue:indexQueue", async () => {
  // Remove the widgetReadyDispatched guard — it prevented refreshes after
  // initial load. updatePageListCache() is cheap (local index query) and
  // safe to call whenever the index queue drains.
  //
  // OLD:
  //   if (this.widgetReadyDispatched) return;
  //   if (!this.pageListLoaded && ...) { ... }
  //
  // NEW:
  await this.updatePageListCache().catch(console.error);
});
```

> **Note on performance:** `updatePageListCache()` queries the local
> (in-memory / IndexedDB) object index — it does not make a network request.
> In practice it completes in < 50 ms and is safe to call on every index-queue
> drain. The index queue drains at most once per changed file, not continuously.

---

## What each fix covers

| Scenario | Before | After |
|---|---|---|
| Create a new page from sidebar `+` button | Sidebar updates after next page-navigator open | Immediate |
| Save an existing page (rename included) | No update | Immediate |
| Delete a page | No update | Immediate |
| External file added (GitLab sync, rsync, another user) | Never updates | Updates after 10 s poll + re-index |
| External file deleted | Never updates | Updates after 10 s poll + re-index |
| External file modified | Never updates | Updates after 10 s poll + re-index |

---

## Optional: reduce external-change lag below 10 seconds

The 10-second poll interval is defined at the top of `client/client.ts`:

```ts
const fetchFileListInterval = 10000;
```

Lowering it (e.g. to `3000`) makes external changes appear faster at the cost
of more frequent server requests. For a local server this is fine; for a remote
server keep it at 10 s or add server-sent events / WebSocket push (out of scope
here).
