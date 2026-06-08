# Sidebar: fixed categories view + pages toggle

Add a "Categories" home view to the sidebar showing 5 fixed lab sections.
The existing "Pages" button keeps the auto-generated folder list unchanged.
All other sections (search, tags, tasks, templates, attachments) are unaffected.

---

## Part 1 — Add `"home"` to ActiveSection

In `client/types/ui.ts`, add `"home"` to the union type:

```ts
export type ActiveSection =
  | "home"          // ← add
  | "pages"
  | "search"
  | "tags"
  | "tasks"
  | "templates"
  | "attachments"
  | "permissions";
```

In the same file, change the default active section in `initialViewState`:

```ts
activeSection: "home",   // was "pages"
```

---

## Part 2 — Add home button to the rail

In `client/components/sidebar_rail.tsx`, add a home entry at the top of `TOP_ITEMS`:

```ts
const TOP_ITEMS: NavItem[] = [
  { id: "home",   icon: "layout-sidebar", title: "Categories" },  // ← add
  { id: "pages",  icon: "files",          title: "All pages"  },
  { id: "search", icon: "search",         title: "Search"     },
  { id: "tags",   icon: "tag",            title: "Tags"       },
  { id: "tasks",  icon: "list-check",     title: "Tasks"      },
];
```

---

## Part 3 — Add home view to SidebarNav

In `client/components/sidebar_nav.tsx`, add the `CATEGORIES` constant and a new
render branch for `activeSection === "home"`. Place both immediately before the
existing `if (activeSection === "permissions")` block.

**Add the categories constant** at the top of the file (outside the component):

```ts
const CATEGORIES: { label: string; prefix: string; icon: string }[] = [
  { label: "Ongoing projects",    prefix: "Projects",    icon: "ti-flask"         },
  { label: "Project acquisition", prefix: "Acquisition", icon: "ti-currency-euro" },
  { label: "Teaching",            prefix: "Teaching",    icon: "ti-school"        },
  { label: "Lab management",      prefix: "Lab",         icon: "ti-building"      },
  { label: "Personal",            prefix: "Personal",    icon: "ti-user"          },
];
```

**Add the home branch** inside `SidebarNav`, before the `if (activeSection === "permissions")` check:

```tsx
if (activeSection === "home") {
  return (
    <div id="sb-nav-panel">
      <div className="sb-nav-header">
        <span className="sb-nav-workspace-name">My Space</span>
        <button className="sb-nav-new-btn" title="New page" onClick={onNewPage}>
          <i className="ti ti-plus" />
        </button>
      </div>

      <div className="sb-nav-search" onClick={onSearch} role="button">
        <i className="ti ti-search" />
        <span className="sb-nav-search-placeholder">Search...</span>
      </div>

      <div className="sb-nav-section">
        {CATEGORIES.map(({ label, prefix, icon }) => {
          const catPages = pages.filter((p) =>
            p.name.startsWith(prefix + "/") &&
            !(p as any)._isAspiring &&
            !p.name.split("/").pop()!.startsWith("_")
          );
          const isExpanded = expanded.has(prefix);

          return (
            <div key={prefix}>
              <div
                className="sb-nav-item sb-nav-folder"
                onClick={() => toggleCollection(prefix)}
                role="button"
              >
                <i
                  className={`ti ti-chevron-${isExpanded ? "down" : "right"} sb-nav-chevron`}
                  onClick={(e) => { e.stopPropagation(); toggleCollection(prefix); }}
                />
                <i className={`ti ${icon}`} />
                <span className="sb-nav-label">{label}</span>
                {catPages.length > 0 && (
                  <span className="sb-nav-badge">{catPages.length}</span>
                )}
              </div>

              {isExpanded && catPages
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((page) => {
                  const { icon: pageIcon, title } = parsePageTitle(page.name);
                  return (
                    <div
                      key={page.name}
                      className={`sb-nav-item sb-nav-page${
                        currentPage === page.name ? " active" : ""
                      }`}
                      style={{ paddingLeft: "22px" }}
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

The existing `if (activeSection === "permissions")` block and the final `return (...)` 
(which renders pages, tags, tasks, etc.) remain completely unchanged.

---

## Files changed

| File | Change |
|---|---|
| `client/types/ui.ts` | Add `"home"` to `ActiveSection`, set as default |
| `client/components/sidebar_rail.tsx` | Add home button to `TOP_ITEMS` |
| `client/components/sidebar_nav.tsx` | Add `CATEGORIES` constant + `"home"` render branch |
