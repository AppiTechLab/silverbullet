# Tab bar: inline rename by double-click

The top bar `PageNameEditor` is hidden (`showTopBar` defaults to `false`),
so page rename has no UI. Restore it by letting the user double-click the
active tab label to rename the note inline.

```
 [🧪 results ×]  [protocol ×]  [+]
       ↑
  double-click → [ Projects/BioSensor/results_ ]  Enter to commit
```

- **Single click** → activates the tab (unchanged)
- **Double click** → label becomes an editable `<input>` with the full page path
- **Enter** → rename + update backlinks (calls `renamePageCommand`)
- **Escape / blur** → cancel, restore original label

The input shows the **full page path** (e.g. `Projects/BioSensor/results`) so
the user can also move the page to a different folder by editing the prefix.

---

## Files changed

| File | Change |
|---|---|
| `client/components/tab_bar.tsx` | Add rename state and inline input |
| `client/editor_ui.tsx` | Add `onRename` prop, call `renamePageCommand` |

---

## Part 1 — Update `TabBar` props

In `client/components/tab_bar.tsx`, add `onRename` to `TabBarProps`:

```ts
export interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
  onRename: (tabId: string, newPageName: string) => Promise<void>; // ← add
}
```

Destructure it in `TabBar`:

```ts
export function TabBar(
  { tabs, activeTabId, onActivate, onClose, onNew, onRename }: TabBarProps,
) {
```

---

## Part 2 — Rename state

Add the following state inside the `TabBar` function body:

```ts
// tabId currently being renamed, and the draft value
const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
const [renameValue, setRenameValue] = useState("");

const startRename = (tab: Tab) => {
  // Only allow renaming the active tab (keeps UX simple)
  if (tab.id !== activeTabId) {
    onActivate(tab.id);
    return;
  }
  setRenamingTabId(tab.id);
  setRenameValue(tab.pageName);   // full path, e.g. "Projects/BioSensor/results"
};

const commitRename = async (tabId: string) => {
  const newName = renameValue.trim();
  setRenamingTabId(null);
  setRenameValue("");
  if (!newName) return;
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab || newName === tab.pageName) return;
  await onRename(tabId, newName);
};

const cancelRename = () => {
  setRenamingTabId(null);
  setRenameValue("");
};
```

---

## Part 3 — Update the tab render

Replace the tab label `<span>` with a conditional: label span normally,
`<input>` when that tab is being renamed.

Full updated tab `return` block inside the `.map()`:

```tsx
return (
  <div
    key={tab.id}
    className={`sb-tab${isActive ? " active" : ""}${renamingTabId === tab.id ? " renaming" : ""}`}
    title={renamingTabId === tab.id ? undefined : tab.pageName}
    onClick={() => {
      if (renamingTabId) return;   // don't activate while typing
      onActivate(tab.id);
    }}
    onDblClick={() => startRename(tab)}
    role="tab"
  >
    {emoji
      ? <span className="sb-tab-icon">{emoji}</span>
      : <i className="ti ti-file-text sb-tab-icon" />}

    {renamingTabId === tab.id
      ? (
        <input
          autoFocus
          className="sb-tab-rename-input"
          value={renameValue}
          onInput={(e) => setRenameValue((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitRename(tab.id);
            }
            if (e.key === "Escape") cancelRename();
          }}
          onBlur={() => {
            // Short delay so Enter keydown fires before blur
            setTimeout(() => cancelRename(), 100);
          }}
          onClick={(e) => e.stopPropagation()}
          onDblClick={(e) => e.stopPropagation()}
        />
      )
      : (
        <span className="sb-tab-label" title="Double-click to rename">
          {label}
        </span>
      )}

    <span
      className={`sb-tab-close${tab.unsaved ? " unsaved" : ""}`}
      title={tab.unsaved ? "Unsaved changes" : "Close tab"}
      onClick={(e) => {
        e.stopPropagation();
        onClose(tab.id);
      }}
    >
      {tab.unsaved ? "●" : "×"}
    </span>
  </div>
);
```

---

## Part 4 — Wire up in `editor_ui.tsx`

Add the `onRename` prop to `<TabBar>`:

```tsx
<TabBar
  tabs={tabs}
  activeTabId={viewState.activeTabId ?? null}
  onActivate={(tabId) => {
    /* existing activate logic */
  }}
  onClose={(tabId) => {
    /* existing close logic */
  }}
  onNew={() => {
    /* existing new-tab logic */
  }}
  onRename={async (tabId, newPageName) => {
    await client.clientSystem.system.invokeFunction(
      "index.renamePageCommand",
      [{ page: newPageName }],
    );
  }}
/>
```

`renamePageCommand` renames the file on disk and rewrites all wiki-links that
reference the old page name. The tab's `pageName` updates automatically because
`renamePageCommand` navigates to the new path, which triggers the existing
`tab-activate-page` dispatch in the navigation effect.

---

## Part 5 — CSS

Add to `client/styles/editor.scss`:

```scss
// Rename input inside an active tab
.sb-tab-rename-input {
  flex: 1;
  min-width: 120px;
  max-width: 320px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--accent-color);
  outline: none;
  font: inherit;
  font-size: 13px;
  color: var(--editor-fg);
  padding: 0 2px;
  margin: 0;
}

// Suppress close button while renaming so the tab doesn't jitter
.sb-tab.renaming .sb-tab-close {
  display: none;
}
```

---

## Behaviour notes

- Only the **active** tab can be renamed. Double-clicking an inactive tab first
  activates it; a second double-click opens the rename input. This avoids
  accidentally renaming a tab the user didn't intend to edit.
- The rename input shows the **full path** (`Projects/BioSensor/results`), not
  just the filename. Editing the folder prefix moves the note to a different
  folder (SilverBullet treats `/` in page names as folder separators).
- Blur cancels (with 100 ms delay) to avoid a race where the user presses Enter
  and blur fires immediately after.
- If `renamePageCommand` fails (e.g. a page with that name already exists) it
  shows SilverBullet's standard flash notification and leaves the page at the
  old name.
