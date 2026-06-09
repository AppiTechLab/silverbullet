# Sidebar: per-folder new note / new subfolder

Add a `+` button to every subfolder row in the category nav panel. Clicking it
reveals a two-option menu (New note / New folder). Choosing one shows an inline
text input directly in the sidebar. Pressing Enter navigates to the new page,
which SilverBullet creates automatically on first save.

```
  ├── 📁 BioSensor          [+]   ← hover to reveal +
  │   ├─ results.md               ← clicking + shows:
  │   └─ protocol.md         ┌──────────────────────┐
  │                           │ 📄 New note          │
  └── 📁 NLP-2026          [+] 📁 New folder        │
                              └──────────────────────┘
                                    ↓ after choosing:
                              [ BioSensor/_________ ] ← inline input
```

The folder `+` replaces the page-count badge on hover. The header `+` (root of
the active category) keeps its existing behaviour.

---

## Files changed

| File | Change |
|---|---|
| `client/components/sidebar_nav.tsx` | Add new-item state, dropdown, inline input |
| `client/editor_ui.tsx` | Add `onNewPageInFolder` prop |
| `client/styles/editor.scss` | Add `.sb-nav-add-btn`, `.sb-nav-inline-input` |

---

## Part 1 — Props

In `client/components/sidebar_nav.tsx`, add one prop to `SidebarNavProps`:

```ts
export interface SidebarNavProps {
  // ...existing props...
  onNewPageInFolder: (path: string) => void;
}
```

Destructure it in the `SidebarNav` function signature.

---

## Part 2 — New-item state

Add the following state at the top of the `SidebarNav` function body (alongside
the existing `expanded` and `expandedTags` state):

```ts
// Which folder is pending a new-item, and which type
type NewItemState = {
  parentFolder: string;   // e.g. "Projects/BioSensor"
  type: "note" | "folder";
  value: string;
} | null;

const [newItemMenu, setNewItemMenu] = useState<string | null>(null); // folder path with open menu
const [newItem, setNewItem] = useState<NewItemState>(null);

// Close everything on Escape
const cancelNew = () => {
  setNewItemMenu(null);
  setNewItem(null);
};
```

---

## Part 3 — Helper: commit the new item

Add this helper inside the component (before the `return`):

```ts
const commitNewItem = () => {
  if (!newItem || !newItem.value.trim()) {
    cancelNew();
    return;
  }
  const name = newItem.value.trim();
  const path =
    newItem.type === "note"
      ? `${newItem.parentFolder}/${name}`
      : `${newItem.parentFolder}/${name}/Untitled`;
  cancelNew();
  onNewPageInFolder(path);
};
```

---

## Part 4 — Helper: inline input row

Add this small helper component **outside** `SidebarNav` (e.g. at the bottom of
the file, before the export):

```tsx
function InlineInput({
  placeholder,
  onCommit,
  onCancel,
}: {
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="sb-nav-inline-input-row">
      <i className="ti ti-corner-down-right sb-nav-inline-icon" />
      <input
        autoFocus
        className="sb-nav-inline-input"
        placeholder={placeholder}
        value={value}
        onInput={(e) => setValue((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit(value);
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => {
          // Short delay so a click on "commit" registers first
          setTimeout(onCancel, 150);
        }}
      />
    </div>
  );
}
```

---

## Part 5 — Per-subfolder + button and dropdown

In the `category:` branch, update the subfolder row render. Replace the existing
`<div className="sb-nav-item sb-nav-folder" ...>` block with this:

```tsx
{Array.from(subFolders.entries()).map(([sub, subPages]) => {
  const folderPath = `${folderPrefix}/${sub}`;
  const isExpanded = expanded.has(folderPath);
  const menuOpen = newItemMenu === folderPath;
  const inputActive = newItem?.parentFolder === folderPath;

  return (
    <div key={sub}>
      {/* Folder row */}
      <div
        className="sb-nav-item sb-nav-folder"
        onClick={() => {
          cancelNew();
          toggleCollection(folderPath);
        }}
        role="button"
      >
        <i
          className={`ti ti-chevron-${isExpanded ? "down" : "right"} sb-nav-chevron`}
          onClick={(e) => {
            e.stopPropagation();
            cancelNew();
            toggleCollection(folderPath);
          }}
        />
        <i className="ti ti-folder" />
        <span className="sb-nav-label">{sub}</span>

        {/* Right side: badge (default) or + button (hover) */}
        <span className="sb-nav-folder-actions">
          <span className="sb-nav-badge sb-nav-badge-count">{subPages.length}</span>
          <button
            className="sb-nav-add-btn"
            title="New note or folder"
            onClick={(e) => {
              e.stopPropagation();
              setNewItem(null);
              setNewItemMenu(menuOpen ? null : folderPath);
            }}
          >
            <i className="ti ti-plus" />
          </button>
        </span>

        {/* Dropdown menu */}
        {menuOpen && (
          <div
            className="sb-nav-add-menu"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="sb-nav-add-menu-item"
              onClick={() => {
                setNewItemMenu(null);
                setNewItem({ parentFolder: folderPath, type: "note", value: "" });
              }}
            >
              <i className="ti ti-file-plus" />
              New note
            </button>
            <button
              className="sb-nav-add-menu-item"
              onClick={() => {
                setNewItemMenu(null);
                setNewItem({ parentFolder: folderPath, type: "folder", value: "" });
              }}
            >
              <i className="ti ti-folder-plus" />
              New folder
            </button>
          </div>
        )}
      </div>

      {/* Inline input — shown after choosing a type */}
      {inputActive && (
        <InlineInput
          placeholder={
            newItem!.type === "note"
              ? `Note name in ${sub}/`
              : `Folder name in ${sub}/`
          }
          onCommit={(value) => {
            const name = value.trim();
            if (!name) { cancelNew(); return; }
            const path =
              newItem!.type === "note"
                ? `${folderPath}/${name}`
                : `${folderPath}/${name}/Untitled`;
            cancelNew();
            onNewPageInFolder(path);
          }}
          onCancel={cancelNew}
        />
      )}

      {/* Sub-pages (unchanged) */}
      {isExpanded && subPages.map((page) => {
        const { icon: pageIcon, title } = parsePageTitle(page.name);
        return (
          <div
            key={page.name}
            className={`sb-nav-item sb-nav-page${currentPage === page.name ? " active" : ""}`}
            style={{ paddingLeft: "28px" }}
            onClick={() => onPageSelect(page.name)}
            role="button"
          >
            {pageIcon
              ? <span className="sb-nav-page-emoji">{pageIcon}</span>
              : <i className="ti ti-file" />}
            <span className="sb-nav-label">{title}</span>
          </div>
        );
      })}
    </div>
  );
})}
```

---

## Part 6 — Wire up in editor_ui.tsx

In `client/editor_ui.tsx`, add the `onNewPageInFolder` prop to `<SidebarNav>`:

```tsx
<SidebarNav
  {/* ...existing props... */}
  onNewPageInFolder={(path) => {
    void client.navigate({ path });
  }}
/>
```

`client.navigate({ path })` opens a page by that exact path. If the page does
not exist yet, SilverBullet creates it when the user first saves (standard
behaviour — the same thing that happens when you follow a wiki-link to a new
page).

---

## Part 7 — CSS

Add to `client/styles/editor.scss`:

```scss
// ── Per-folder action controls ───────────────────────────────────────────────

// Container that holds both the page-count badge and the + button.
// They stack on top of each other; hover reveals the + and hides the badge.
.sb-nav-folder-actions {
  position: relative;
  margin-left: auto;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.sb-nav-badge-count {
  transition: opacity 0.1s;
}
.sb-nav-add-btn {
  position: absolute;
  right: 0;
  opacity: 0;
  background: none;
  border: none;
  padding: 0 2px;
  cursor: pointer;
  color: var(--editor-fg);
  display: flex;
  align-items: center;
  font-size: 13px;
  transition: opacity 0.1s;
  &:hover { color: var(--accent-color); }
}

// On row hover: hide badge, reveal + button
.sb-nav-folder:hover .sb-nav-badge-count { opacity: 0; }
.sb-nav-folder:hover .sb-nav-add-btn    { opacity: 1; }

// ── Dropdown menu ─────────────────────────────────────────────────────────────
.sb-nav-add-menu {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 200;
  background: var(--modal-bg, var(--editor-bg));
  border: 1px solid var(--editor-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px;
  min-width: 150px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sb-nav-add-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: none;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--editor-fg);
  text-align: left;
  &:hover { background: var(--nav-hover-bg, rgba(0,0,0,0.06)); }
}

// ── Inline input row ──────────────────────────────────────────────────────────
.sb-nav-inline-input-row {
  display: flex;
  align-items: center;
  padding: 3px 6px 3px 28px;
  gap: 4px;
}

.sb-nav-inline-icon {
  color: var(--editor-fg);
  opacity: 0.4;
  font-size: 13px;
  flex-shrink: 0;
}

.sb-nav-inline-input {
  flex: 1;
  background: var(--editor-bg);
  border: 1px solid var(--accent-color);
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 13px;
  color: var(--editor-fg);
  outline: none;
  min-width: 0;
}
```

---

## Behaviour notes

- The `+` button replaces the page-count badge only on hover — the badge is
  visible by default and disappears when you hover the folder row.
- The dropdown uses absolute positioning relative to the `.sb-nav-folder` row
  (which must have `position: relative`).
- Pressing **Escape** or clicking away from the inline input cancels the action.
- Typing `subfolder/notename` in the "New note" input creates a nested structure
  automatically (SilverBullet treats `/` in page paths as folder separators).
- Creating a folder navigates to `parentFolder/newFolder/Untitled`. The folder
  appears in the sidebar once the page is saved.
