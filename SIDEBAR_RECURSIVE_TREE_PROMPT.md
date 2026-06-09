# Sidebar: recursive folder tree with collapse/expand

Both the **category view** and the **all-pages view** currently render pages
flat inside each folder — nested sub-directories are invisible or lose their
structure. Replace the flat rendering with a recursive tree so every subfolder
at every depth is independently collapsible.

```
Before (flat):               After (recursive):
📁 BioSensor                 📁 BioSensor ▼
  results.md       →           📁 Data ▶ (click to expand)
  protocol.md                    batch1.md
  batch1.md                    results.md
  batch2.md                    protocol.md
```

Only `client/components/sidebar_nav.tsx` needs to change.

---

## Part 1 — Tree data type

Add the following type and builder near the top of `sidebar_nav.tsx`, after the
`parsePageTitle` function:

```ts
type TreeNode = {
  path: string;           // full path from space root, e.g. "Projects/BioSensor/Data"
  name: string;           // last segment only, e.g. "Data"
  pages: PageMeta[];      // pages *directly* in this folder (no deeper nesting)
  children: TreeNode[];   // immediate sub-folders, sorted alphabetically
};

/**
 * Build a recursive folder tree from a flat list of pages.
 *
 * @param pages  pages to include (already filtered to the current scope)
 * @param prefix path prefix for this level, e.g. "Projects/BioSensor"
 *               — pages at root level pass ""
 */
function buildTree(pages: PageMeta[], prefix: string): TreeNode[] {
  const folderMap = new Map<string, PageMeta[]>(); // folderPath → pages inside
  const directPages: PageMeta[] = [];

  for (const page of pages) {
    // strip the prefix to get the relative path within this scope
    const relative = prefix
      ? page.name.slice(prefix.length + 1)
      : page.name;
    const slash = relative.indexOf("/");

    if (slash === -1) {
      // Page lives directly in this folder
      directPages.push(page);
    } else {
      // Page lives in a sub-folder — record it under that sub-folder path
      const segment = relative.slice(0, slash);
      const folderPath = prefix ? `${prefix}/${segment}` : segment;
      if (!folderMap.has(folderPath)) folderMap.set(folderPath, []);
      folderMap.get(folderPath)!.push(page);
    }
  }

  const children: TreeNode[] = Array.from(folderMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folderPath, folderPages]) => {
      const name = folderPath.slice(folderPath.lastIndexOf("/") + 1);
      // Split folderPages into direct children and deeper descendants
      const direct = folderPages.filter((p) => {
        const rel = p.name.slice(folderPath.length + 1);
        return !rel.includes("/");
      });
      const deeper = folderPages.filter((p) => {
        const rel = p.name.slice(folderPath.length + 1);
        return rel.includes("/");
      });
      return {
        path: folderPath,
        name,
        pages: direct.sort((a, b) => a.name.localeCompare(b.name)),
        children: buildTree(deeper, folderPath),
      };
    });

  return children;
}
```

---

## Part 2 — Recursive render function

Add `renderTreeNode` as a function inside `SidebarNav` (it needs access to
`expanded`, `toggleCollection`, `currentPage`, `onPageSelect`, and the
`newItem` / `newItemMenu` state from the new-item feature):

```tsx
const renderTreeNode = (
  node: TreeNode,
  depth: number,
  // Pass onNewPageInFolder through so the + button still works at every level
  onNew?: (path: string) => void,
): JSX.Element => {
  const isExpanded = expanded.has(node.path);
  const indent = depth * 14; // px indentation per level

  return (
    <div key={node.path}>
      {/* Folder row */}
      <div
        className="sb-nav-item sb-nav-folder"
        style={{ paddingLeft: `${6 + indent}px` }}
        onClick={() => toggleCollection(node.path)}
        role="button"
      >
        <i
          className={`ti ti-chevron-${isExpanded ? "down" : "right"} sb-nav-chevron`}
          onClick={(e) => {
            e.stopPropagation();
            toggleCollection(node.path);
          }}
        />
        <i className="ti ti-folder" />
        <span className="sb-nav-label">{node.name}</span>

        {/* Page-count badge / + button (compatible with SIDEBAR_NEW_ITEM_PROMPT) */}
        <span className="sb-nav-folder-actions">
          <span className="sb-nav-badge sb-nav-badge-count">
            {node.pages.length + node.children.length}
          </span>
          {onNew && (
            <button
              className="sb-nav-add-btn"
              title="New note or folder"
              onClick={(e) => {
                e.stopPropagation();
                // Delegate to the existing new-item menu logic
                // by calling onNew with the folder path
                onNew(node.path);
              }}
            >
              <i className="ti ti-plus" />
            </button>
          )}
        </span>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div>
          {/* Direct pages */}
          {node.pages.map((page) => {
            const { icon, title } = parsePageTitle(page.name);
            return (
              <div
                key={page.name}
                className={`sb-nav-item sb-nav-page${
                  currentPage === page.name ? " active" : ""
                }`}
                style={{ paddingLeft: `${20 + indent}px` }}
                onClick={() => onPageSelect(page.name)}
                role="button"
              >
                {icon
                  ? <span className="sb-nav-page-emoji">{icon}</span>
                  : <i className="ti ti-file" />}
                <span className="sb-nav-label">{title}</span>
              </div>
            );
          })}

          {/* Recursive sub-folders */}
          {node.children.map((child) =>
            renderTreeNode(child, depth + 1, onNew)
          )}
        </div>
      )}
    </div>
  );
};
```

---

## Part 3 — Update the category view

In the `if (activeSection.startsWith("category:"))` branch, replace the
existing `subFolders` / `rootPages` computation and the `.map()` that renders
them with the tree builder:

Remove the entire block from:
```ts
const subFolders = new Map<string, typeof pages>();
const rootPages: typeof pages = [];
// ...for loop...
```

through the `{Array.from(subFolders.entries()).map(...)}` render.

Replace with:

```tsx
// Build the recursive tree rooted at folderPrefix
const tree = buildTree(folderPages, folderPrefix);

// Pages that sit directly in the category root (not inside any subfolder)
const rootPages = folderPages
  .filter((p) => {
    const relative = p.name.slice(folderPrefix.length + 1);
    return !relative.includes("/");
  })
  .sort((a, b) => a.name.localeCompare(b.name));
```

And in the JSX, replace the old subfolder render with:

```tsx
<div className="sb-nav-section">
  {/* Pages directly at the category root */}
  {rootPages.map((page) => {
    const { icon: pageIcon, title } = parsePageTitle(page.name);
    return (
      <div
        key={page.name}
        className={`sb-nav-item sb-nav-page${
          currentPage === page.name ? " active" : ""
        }`}
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

  {/* Recursive sub-tree */}
  {tree.map((node) =>
    renderTreeNode(node, 0, onNewPageInFolder)
  )}
</div>
```

---

## Part 4 — Update the all-pages view

In the `// activeSection === "pages"` branch, replace the flat page list inside
expanded collections with a tree render.

Find the inner render inside `sortedCollections.map`:

```tsx
// REMOVE this flat page list:
{isExpanded &&
  collPages.map((page) => { ... })}
```

Replace with:

```tsx
{isExpanded && (() => {
  // Direct pages at the collection root
  const directPages = collPages
    .filter((p) => {
      const relative = p.name.slice(coll.length + 1);
      return !relative.includes("/");
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Build sub-tree for deeper nesting
  const deepPages = collPages.filter((p) => {
    const relative = p.name.slice(coll.length + 1);
    return relative.includes("/");
  });
  const subTree = buildTree(deepPages, coll);

  return (
    <>
      {directPages.map((page) => {
        const { icon, title } = parsePageTitle(page.name);
        return (
          <div
            key={page.name}
            className={`sb-nav-item sb-nav-page${
              currentPage === page.name ? " active" : ""
            }`}
            style={{ paddingLeft: "20px" }}
            onClick={() => onPageSelect(page.name)}
            role="button"
          >
            {icon
              ? <span className="sb-nav-page-emoji">{icon}</span>
              : <i className="ti ti-file-text" />}
            <span className="sb-nav-label">{title}</span>
          </div>
        );
      })}
      {subTree.map((node) => renderTreeNode(node, 1))}
    </>
  );
})()}
```

---

## Behaviour notes

- **`expanded` Set** already stores full paths as keys (`"Projects/BioSensor"`,
  `"Projects/BioSensor/Data"`), so independent collapse state at every depth
  works without any state changes.
- **All folders start collapsed.** Users click the chevron or the row to expand.
  This keeps the sidebar compact when you first open a category with many
  sub-directories.
- **Indentation** increases by `14 px` per depth level. The `depth` parameter
  in `renderTreeNode` drives `paddingLeft` on both folder rows and page rows so
  the tree is visually clear at any nesting depth.
- **Badge count** on a collapsed folder shows
  `pages.length + children.length` — direct pages plus immediate sub-folders —
  so the user has a sense of folder size without expanding it.
- **New-item + button** (from `SIDEBAR_NEW_ITEM_PROMPT.md`) passes `node.path`
  to `onNewPageInFolder` so it keeps working at any depth. If that feature has
  not been implemented yet, simply omit the `onNew` parameter and the button.
