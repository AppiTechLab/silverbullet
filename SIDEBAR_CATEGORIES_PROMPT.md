# Sidebar: icon-only category rail (Make.md Spaces style)

Redesign the sidebar so top-level folders appear as icon-only buttons at the top
of the rail. Clicking a folder icon shows that folder's pages in the nav panel.
Fixed sections (search, tags, tasks) remain below a divider.

```
┌──┬──────────────────────┐
│🧪│ Projects              │  ← active folder
│💰│  ├── BioSensor/       │
│🎓│  │   ├── results.md   │
│🏢│  │   └── protocol.md  │
│👤│  └── NLP-2026/        │
│──│                       │
│🔍│                       │  ← fixed sections
│🏷│                       │
│☑ │                       │
└──┴──────────────────────┘
```

Folder icons come from a leading emoji in the folder name (`🧪 Projects/`).
No config required — creating a folder automatically adds it to the rail.

---

## Part 1 — Extend ActiveSection type

In `client/types/ui.ts`, extend `ActiveSection` to support dynamic category keys
using a template literal type:

```ts
export type ActiveSection =
  | `category:${string}`   // ← dynamic: one per top-level folder
  | "pages"
  | "search"
  | "tags"
  | "tasks"
  | "templates"
  | "attachments"
  | "permissions";
```

Remove `"home"` if it was added previously — it is no longer needed.

Do NOT change `initialViewState.activeSection` here — the default will be set
dynamically in `editor_ui.tsx` once folders are known.

---

## Part 2 — Shared folder parsing utility

Create `client/lib/folder_icon.ts` so both `editor_ui.tsx` and `sidebar_nav.tsx`
can parse folder emoji without duplicating code:

```ts
const SHORTCODE_RE = /^(:[a-z0-9_+-]+:)\s*/;
const RAW_EMOJI_RE = /^(\p{Extended_Pictographic})\s*/u;

// emojiMap is the existing map from client/codemirror/emojiList.ts
import { emojiMap } from "../codemirror/emojiList.ts";

export type FolderMeta = {
  prefix: string;   // raw folder name, e.g. "🧪 Projects"
  icon: string;     // emoji character to display, e.g. "🧪"
  label: string;    // display name without emoji, e.g. "Projects"
};

/** Parse a top-level folder name into icon + label. */
export function parseFolderMeta(folderName: string): FolderMeta {
  // Shortcode: :test_tube: Projects
  const shortcodeMatch = folderName.match(SHORTCODE_RE);
  if (shortcodeMatch) {
    const emoji = emojiMap[shortcodeMatch[1]];
    if (emoji) {
      return {
        prefix: folderName,
        icon: emoji,
        label: folderName.slice(shortcodeMatch[0].length).trim() || folderName,
      };
    }
  }

  // Raw Unicode emoji: 🧪 Projects
  const rawMatch = folderName.match(RAW_EMOJI_RE);
  if (rawMatch) {
    return {
      prefix: folderName,
      icon: rawMatch[1],
      label: folderName.slice(rawMatch[0].length).trim() || folderName,
    };
  }

  // No emoji: use folder icon placeholder (rendered in the rail as ti-folder)
  return { prefix: folderName, icon: "", label: folderName };
}

/** Extract all unique top-level folder names from a page list. */
export function topLevelFolders(pages: { name: string }[]): string[] {
  const seen = new Set<string>();
  for (const page of pages) {
    const slash = page.name.indexOf("/");
    if (slash > 0) seen.add(page.name.slice(0, slash));
  }
  return Array.from(seen).sort();
}
```

---

## Part 3 — Update SidebarRail

In `client/components/sidebar_rail.tsx`, accept a `categories` prop and render
folder icons above the fixed sections.

**Update the `NavItem` type** to support either a Tabler icon or an emoji:

```ts
type NavItem = {
  id: ActiveSection;
  icon?: string;    // Tabler icon name without "ti-", e.g. "search"
  emoji?: string;   // Raw emoji character, e.g. "🧪"
  title: string;
};
```

**Update the `Props` type:**

```ts
import type { FolderMeta } from "../lib/folder_icon.ts";

type Props = {
  activeSection: ActiveSection;
  onSectionChange: (section: ActiveSection) => void;
  categories: FolderMeta[];   // ← add
  isAdmin?: boolean;
  showToc: boolean;
  onToggleToc: () => void;
};
```

**Update the render** — add a category zone above the existing top items:

```tsx
export function SidebarRail(
  { activeSection, onSectionChange, categories, isAdmin, showToc, onToggleToc }: Props,
) {
  return (
    <div id="sb-icon-rail">
      <div className="sb-rail-logo">
        <i className="ti ti-bolt" />
      </div>

      {/* Dynamic category icons — one per top-level folder */}
      {categories.map((cat) => {
        const sectionId: ActiveSection = `category:${cat.prefix}`;
        return (
          <button
            key={cat.prefix}
            className={`sb-rail-btn${activeSection === sectionId ? " active" : ""}`}
            title={cat.label}
            onClick={() => onSectionChange(sectionId)}
          >
            {cat.icon
              ? <span className="sb-rail-emoji">{cat.icon}</span>
              : <i className="ti ti-folder" />}
          </button>
        );
      })}

      <div className="sb-rail-divider" />

      {/* Fixed sections */}
      {TOP_ITEMS.map((item) => (
        <button
          key={item.id}
          className={`sb-rail-btn${activeSection === item.id ? " active" : ""}`}
          title={item.title}
          onClick={() => onSectionChange(item.id)}
        >
          <i className={`ti ti-${item.icon}`} />
        </button>
      ))}

      {/* ... rest of rail unchanged (MID_ITEMS, spacer, permissions, TOC) */}
    </div>
  );
}
```

**Add CSS** in `client/styles/editor.scss` for the emoji icon in the rail:

```scss
.sb-rail-emoji {
  font-size: 18px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

Remove `"home"` from `TOP_ITEMS` if it was added previously.

---

## Part 4 — Update SidebarNav

In `client/components/sidebar_nav.tsx`, handle `activeSection` values that start
with `"category:"` — extract the folder prefix and show only pages from that folder.

Add the import at the top:

```ts
import { parseFolderMeta } from "../lib/folder_icon.ts";
```

Add the category branch **before** the `if (activeSection === "permissions")` block:

```tsx
if (activeSection.startsWith("category:")) {
  const folderPrefix = activeSection.slice("category:".length);
  const { label, icon } = parseFolderMeta(folderPrefix);

  const folderPages = pages
    .filter((p) =>
      p.name.startsWith(folderPrefix + "/") &&
      !(p as any)._isAspiring &&
      !p.name.split("/").pop()!.startsWith("_")
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Group by sub-folder within this category
  const subFolders = new Map<string, typeof pages>();
  const rootPages: typeof pages = [];

  for (const page of folderPages) {
    const relativeName = page.name.slice(folderPrefix.length + 1);
    const slash = relativeName.indexOf("/");
    if (slash > 0) {
      const sub = relativeName.slice(0, slash);
      if (!subFolders.has(sub)) subFolders.set(sub, []);
      subFolders.get(sub)!.push(page);
    } else {
      rootPages.push(page);
    }
  }

  return (
    <div id="sb-nav-panel">
      <div className="sb-nav-header">
        <span className="sb-nav-workspace-name">
          {icon && <span style={{ marginRight: "6px" }}>{icon}</span>}
          {label}
        </span>
        <button className="sb-nav-new-btn" title="New page" onClick={onNewPage}>
          <i className="ti ti-plus" />
        </button>
      </div>

      <div className="sb-nav-search" onClick={onSearch} role="button">
        <i className="ti ti-search" />
        <span className="sb-nav-search-placeholder">Search...</span>
      </div>

      <div className="sb-nav-section">
        {/* Root-level pages in this folder */}
        {rootPages.map((page) => {
          const { icon: pageIcon, title } = parsePageTitle(page.name);
          return (
            <div
              key={page.name}
              className={`sb-nav-item sb-nav-page${currentPage === page.name ? " active" : ""}`}
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

        {/* Sub-folders */}
        {Array.from(subFolders.entries()).map(([sub, subPages]) => {
          const isExpanded = expanded.has(`${folderPrefix}/${sub}`);
          return (
            <div key={sub}>
              <div
                className="sb-nav-item sb-nav-folder"
                onClick={() => toggleCollection(`${folderPrefix}/${sub}`)}
                role="button"
              >
                <i
                  className={`ti ti-chevron-${isExpanded ? "down" : "right"} sb-nav-chevron`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleCollection(`${folderPrefix}/${sub}`);
                  }}
                />
                <i className="ti ti-folder" />
                <span className="sb-nav-label">{sub}</span>
                <span className="sb-nav-badge">{subPages.length}</span>
              </div>
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
      </div>
    </div>
  );
}
```

Also update `parsePageTitle` in the same file to handle raw Unicode emoji
(in addition to the existing shortcode format):

```ts
const PAGE_EMOJI_RE = /^(:[a-z0-9_+-]+:)\s*/;
const RAW_EMOJI_RE  = /^(\p{Extended_Pictographic})\s*/u;

function parsePageTitle(name: string): { icon: string | null; title: string } {
  const base = name.slice(name.lastIndexOf("/") + 1);

  const shortcodeMatch = base.match(PAGE_EMOJI_RE);
  if (shortcodeMatch) {
    const emoji = emojiMap[shortcodeMatch[1]];
    if (emoji) {
      return { icon: emoji, title: base.slice(shortcodeMatch[0].length) || base };
    }
  }

  const rawMatch = base.match(RAW_EMOJI_RE);
  if (rawMatch) {
    return { icon: rawMatch[1], title: base.slice(rawMatch[0].length).trim() || base };
  }

  return { icon: null, title: base };
}
```

---

## Part 5 — Wire up in editor_ui.tsx

In `client/editor_ui.tsx`, compute categories from the live page list and pass them
to both `SidebarRail` and set the default active section.

Add the import:

```ts
import { topLevelFolders, parseFolderMeta, type FolderMeta } from "./lib/folder_icon.ts";
```

Inside the component, derive categories from `viewState.allPages`:

```ts
const categories: FolderMeta[] = topLevelFolders(viewState.allPages)
  .map(parseFolderMeta);
```

Set the default active section to the first category when the section is still
at its initial value and categories are available. Add a `useEffect`:

```ts
useEffect(() => {
  if (
    categories.length > 0 &&
    !viewState.activeSection.startsWith("category:") &&
    viewState.activeSection === "pages"  // still at default
  ) {
    dispatch({
      type: "set-active-section",
      section: `category:${categories[0].prefix}`,
    });
  }
}, [categories.length]);
```

Pass categories to `SidebarRail`:

```tsx
<SidebarRail
  activeSection={viewState.activeSection}
  onSectionChange={(section) =>
    dispatch({ type: "set-active-section", section })}
  categories={categories}              {/* ← add */}
  isAdmin={client.bootConfig.isAdmin ?? false}
  showToc={viewState.showToc}
  onToggleToc={() => dispatch({ type: "toggle-toc" })}
/>
```

---

## How to use

Name top-level folders with a leading emoji:

```
🧪 Projects/
💰 Acquisition/
🎓 Teaching/
🏢 Lab/
👤 Personal/
```

Each folder gets its own icon in the rail automatically. Reorder folders on disk
to reorder the rail. No config required.

---

## Files changed / created

| File | Change |
|---|---|
| `client/types/ui.ts` | Add `` `category:${string}` `` to `ActiveSection` |
| `client/lib/folder_icon.ts` | NEW — `parseFolderMeta`, `topLevelFolders` |
| `client/components/sidebar_rail.tsx` | Accept `categories` prop, render emoji icons above divider |
| `client/components/sidebar_nav.tsx` | Handle `category:*` sections, update `parsePageTitle` |
| `client/editor_ui.tsx` | Derive `categories`, pass to rail, set default section |
| `client/styles/editor.scss` | Add `.sb-rail-emoji` |
