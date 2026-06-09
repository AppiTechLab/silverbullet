# Sidebar: rule-based spaces (upgrade from option A)

Upgrade the sidebar from auto-detected folders (option A) to explicitly defined
spaces with rules — each space can match a folder, a tag, or a combination.

**Prerequisite:** option A (`SIDEBAR_CATEGORIES_PROMPT.md`) must be implemented first.
This prompt only describes what changes relative to option A.

---

## What changes vs option A

| Part | Option A | Option B (this prompt) |
|---|---|---|
| Category source | Auto-detected top-level folders | `config.set` in CONFIG page |
| Filter logic | `page.name.startsWith(prefix)` | Rule evaluator: `folder:`, `tag:`, `AND`/`OR` |
| Icon source | Emoji in folder name | Emoji in space label |
| New files needed | — | `plugs/index/sidebar.ts`, update `folder_icon.ts` |

The rail UI, `ActiveSection` type, and `editor_ui.tsx` wiring are unchanged.

---

## Part 1 — Space definition type

In `client/types/ui.ts`, add `SpaceDefinition` and extend `uiOptions`:

```ts
export type SpaceDefinition = {
  label: string;   // "🧪 Projects" — leading emoji becomes the rail icon
  rule: string;    // see rule syntax below
};

// Inside uiOptions:
uiOptions: {
  // ...existing fields...
  sidebarSpaces?: SpaceDefinition[];   // ← add
};
```

**Rule syntax:**

| Rule | Meaning |
|---|---|
| `folder:Projects` | Pages whose path starts with `Projects/` |
| `tag:teaching` | Pages tagged `#teaching` in frontmatter |
| `folder:A OR folder:B` | Pages in either folder |
| `folder:Acquisition AND tag:active` | Pages in Acquisition AND tagged active |

Rules are case-sensitive. `AND` binds tighter than `OR`.

---

## Part 2 — Rule evaluator

In `client/lib/folder_icon.ts`, add the rule evaluator alongside the existing
`parseFolderMeta` and `topLevelFolders` functions:

```ts
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";

/**
 * Evaluate a space rule against a page.
 * Supports: folder:X, tag:X, AND, OR
 */
export function evalRule(rule: string, page: PageMeta): boolean {
  // OR — lowest precedence, split first
  if (rule.includes(" OR ")) {
    return rule.split(" OR ").some((r) => evalRule(r.trim(), page));
  }
  // AND
  if (rule.includes(" AND ")) {
    return rule.split(" AND ").every((r) => evalRule(r.trim(), page));
  }

  // Atomic rules
  if (rule.startsWith("folder:")) {
    const prefix = rule.slice(7).trim();
    return page.name.startsWith(prefix + "/") || page.name === prefix;
  }
  if (rule.startsWith("tag:")) {
    const tag = rule.slice(4).trim();
    return ((page as any).itags ?? []).includes(tag);
  }

  console.warn("Unknown space rule:", rule);
  return false;
}

/**
 * Parse a space label ("🧪 Projects") into icon + display name.
 * Reuses the existing parseFolderMeta logic.
 */
export function parseSpaceLabel(label: string): { icon: string; name: string } {
  const { icon, label: name } = parseFolderMeta(label);
  return { icon, name };
}
```

---

## Part 3 — Plug: load spaces from config on startup

Create `plugs/index/sidebar.ts`:

```ts
import { config, editor } from "@silverbulletmd/silverbullet/syscalls";
import type { SpaceDefinition } from "../../client/types/ui.ts";

const DEFAULT_SPACES: SpaceDefinition[] = [
  { label: "🧪 Projects",    rule: "folder:Projects"    },
  { label: "💰 Acquisition", rule: "folder:Acquisition" },
  { label: "🎓 Teaching",    rule: "folder:Teaching"    },
  { label: "🏢 Lab",         rule: "folder:Lab"         },
  { label: "👤 Personal",    rule: "folder:Personal"    },
];

export async function loadSidebarSpaces() {
  const spaces = await config.get("sidebar.spaces", DEFAULT_SPACES);
  await editor.setUiOption("sidebarSpaces", spaces);
}
```

Register in `plugs/index/index.plug.yaml`:

```yaml
functions:
  loadSidebarSpaces:
    path: "./sidebar.ts:loadSidebarSpaces"
    events:
      - editor:init
```

---

## Part 4 — Update editor_ui.tsx

Replace the auto-detection logic with config-driven spaces.

Remove:
```ts
import { topLevelFolders, parseFolderMeta, type FolderMeta } from "./lib/folder_icon.ts";

const categories: FolderMeta[] = topLevelFolders(viewState.allPages)
  .map(parseFolderMeta);
```

Add:
```ts
import { parseSpaceLabel } from "./lib/folder_icon.ts";
import type { SpaceDefinition } from "./types/ui.ts";

// Use config-defined spaces, or fall back to auto-detected folders
const spaces: SpaceDefinition[] = viewState.uiOptions.sidebarSpaces
  ?? topLevelFolders(viewState.allPages).map((f) => ({
       label: f,
       rule: `folder:${f}`,
     }));

// Map to FolderMeta shape expected by SidebarRail
const categories = spaces.map((s) => ({
  ...parseSpaceLabel(s.label),
  prefix: s.label,   // used as the section key: "category:🧪 Projects"
}));
```

> The fallback to `topLevelFolders` means the sidebar still works even before
> `config.set("sidebar.spaces", ...)` is defined — option A behaviour is preserved.

Also keep the existing `useEffect` that sets the default active section on first load.

---

## Part 5 — Update sidebar_nav.tsx filter

In the `if (activeSection.startsWith("category:"))` branch, replace the folder
prefix filter with the rule evaluator.

Add the import:
```ts
import { evalRule } from "../lib/folder_icon.ts";
import type { SpaceDefinition } from "../types/ui.ts";
```

Add `spaces` to `SidebarNavProps`:
```ts
spaces?: SpaceDefinition[];
```

Replace:
```ts
const folderPages = pages
  .filter((p) => p.name.startsWith(folderPrefix + "/") && ...)
```

With:
```ts
// Find the space definition for the active section
const spaceLabel = activeSection.slice("category:".length);
const space = spaces?.find((s) => s.label === spaceLabel);
const rule = space?.rule ?? `folder:${spaceLabel}`;

const folderPages = pages
  .filter((p) =>
    evalRule(rule, p) &&
    !(p as any)._isAspiring &&
    !p.name.split("/").pop()!.startsWith("_")
  )
  .sort((a, b) => a.name.localeCompare(b.name));
```

Pass `spaces` from `editor_ui.tsx` to `SidebarNav`:
```tsx
<SidebarNav
  {/* ...existing props... */}
  spaces={spaces}
/>
```

---

## Part 6 — User configuration

In the `CONFIG` page:

```lua
config.set("sidebar.spaces", {
  { label = "🧪 Projects",    rule = "folder:Projects"                         },
  { label = "💰 Acquisition", rule = "folder:Acquisition"                      },
  { label = "🎓 Teaching",    rule = "folder:Teaching OR tag:teaching"          },
  { label = "🏢 Lab",         rule = "folder:Lab"                              },
  { label = "👤 Personal",    rule = "folder:Personal"                         },
  { label = "📌 Active",      rule = "tag:active"                              },
})
```

Run **System: Reload** to apply changes.

Notes:
- Leading emoji in `label` is the rail icon — same as option A
- Order in the config = order in the rail
- Removing an entry removes it from the rail immediately on reload
- The `folder:X` rule does not require `X/` to exist as a real folder — it matches any page whose path starts with `X/`

---

## Files changed / created (delta from option A)

| File | Change |
|---|---|
| `client/types/ui.ts` | Add `SpaceDefinition`, add `sidebarSpaces` to `uiOptions` |
| `client/lib/folder_icon.ts` | Add `evalRule`, `parseSpaceLabel` |
| `plugs/index/sidebar.ts` | NEW — load config on `editor:init` |
| `plugs/index/index.plug.yaml` | Register `loadSidebarSpaces` |
| `client/editor_ui.tsx` | Replace auto-detection with config spaces + fallback |
| `client/components/sidebar_nav.tsx` | Add `spaces` prop, use `evalRule` for filtering |
