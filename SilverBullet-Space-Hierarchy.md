# SilverBullet Space — Proposed Hierarchy

Based on your Obsidian vault structure, this document proposes a canonical folder layout for the SilverBullet team space, along with Obsidian-to-SilverBullet feature mappings.

---

## Proposed Folder Structure

```
/ (SilverBullet Space root)
│
├── SETTINGS.md              ← Space-wide config (replaces .obsidian/app.json)
├── PLUGS.md                 ← Installed plugins
├── index.md                 ← Dashboard / home (queries, recent pages, links)
│
├── AppiTech/                ← All company & startup projects
│   ├── index.md             ← Project portfolio overview
│   │
│   ├── CareConvers/
│   │   ├── index.md
│   │   ├── wiki/            ← Imported from CareConversGitLabWiki (see §GitLab Wikis)
│   │   └── meetings/
│   │
│   ├── GATE/
│   │   └── index.md
│   │
│   ├── HMT/
│   │   └── index.md
│   │
│   ├── ICP4MH/
│   │   └── index.md
│   │
│   ├── RimonTech/
│   │   ├── index.md
│   │   └── wiki/            ← Imported from rimontechGitLabwiki
│   │
│   ├── VimouProject/
│   │   └── index.md
│   │
│   └── XR4Inclusion/
│       ├── index.md
│       └── wiki/            ← Imported from xr4inclusion.wiki
│
├── Lab/                     ← Was LabManagement/
│   ├── index.md
│   ├── Team/                ← Team members, roles, onboarding
│   ├── Wiki/                ← appitechGitLabWiki imported here
│   ├── Meetings/            ← Weekly standups, lab meetings
│   └── Equipment/
│
├── Research/                ← Was Research Segments/ + NDD_Research/
│   ├── index.md
│   ├── NDD/                 ← Neurodevelopmental disorders research
│   │   ├── index.md
│   │   └── literature/      ← Zotero-linked literature notes
│   ├── AIMaintenance/       ← Was AI4Maintenance/
│   │   └── index.md
│   └── Publications/        ← Papers, drafts, submission tracking
│
├── Teaching/
│   ├── index.md
│   ├── UnitTesting/
│   ├── CollaborativeProgramming/
│   ├── ImmersiveTechnologies/
│   └── Physiotherapy/
│
├── Acquisition/             ← Was Projects-Acquisition/
│   ├── index.md
│   └── Proposals/
│
├── Perso/
│   ├── index.md
│   └── Tasks/
│
├── template/                ← SilverBullet templates (was Templates/)
│   ├── meeting.md
│   ├── project.md
│   ├── literature-note.md
│   └── weekly-review.md
│
└── tag/                     ← SilverBullet tag index pages (was Tags/)
    └── (auto-maintained by tag pages)
```

---

## What to Exclude (Obsidian-specific, not needed)

| Path | Reason |
|------|--------|
| `.obsidian/` | Obsidian app config — irrelevant to SilverBullet |
| `.makemd/` | Make.md plugin state |
| `.space/def.json`, `context.mdb`, `views.mdb` | Make.md workspace files |
| `*.canvas` | Canvas format not supported (use Mermaid diagrams instead) |
| `.git/` inside wiki subfolders | Handle separately (see §GitLab Wikis) |
| Obsidian plugin JS files | Not applicable |

---

## Obsidian Feature → SilverBullet Equivalent

| Obsidian | SilverBullet |
|----------|-------------|
| **Dataview** queries | `{{#each page where tags = "..."}}` live queries in any page |
| **Templater** | Space Scripts (JS in `_plug/`) + `template/` folder |
| **Canvas** | Mermaid diagrams (```` ```mermaid ```` blocks) |
| **Make.md Spaces** | Folders (SB treats folders as namespaces) or multi-space setup |
| **Tags** (`#tag`) | Hashtag pages in `tag/` — fully queryable |
| **Backlinks panel** | Built-in backlinks in SilverBullet sidebar |
| **Graph view** | Not built-in — can be added as a custom plug |
| **Zotero** | Via `zotero://` links in frontmatter or a custom space script |
| **Frontmatter** | Rendered as Properties panel (already implemented) |
| **Callouts** | Supported via standard `> [!note]` syntax |
| **Embed `![[]]`** | Supported natively |

---

## GitLab Wikis — Recommended Approach

You have 5 embedded GitLab wiki repos:
- `CareConversGitLabWiki`
- `rimontechGitLabwiki`
- `xr4inclusion.wiki`
- `appitechGitLabWiki`
- `NDD_Research` / `AIMaintenance` (partial)

**Recommended: Git subtrees (not submodules)**

```bash
# Add a GitLab wiki as a subtree into a SilverBullet subfolder
git subtree add --prefix=AppiTech/CareConvers/wiki \
  git@gitlab.com:yourorg/careconvers.wiki.git main --squash

# Pull updates later
git subtree pull --prefix=AppiTech/CareConvers/wiki \
  git@gitlab.com:yourorg/careconvers.wiki.git main --squash

# Push changes back
git subtree push --prefix=AppiTech/CareConvers/wiki \
  git@gitlab.com:yourorg/careconvers.wiki.git main
```

This keeps wiki pages as plain markdown files inside your SilverBullet space — no nested `.git` folders, full SilverBullet navigation and search, and you can still sync changes back to GitLab.

---

## Dashboard Template (`index.md`)

```markdown
---
title: Lab Dashboard
---

# Lab Dashboard

## 🔬 Active Projects
{{#each page where tags = "project" and status != "done" order by modified desc limit 10}}
- [[{{name}}]] — {{status}}
{{/each}}

## 📅 Recent Meetings
{{#each page where tags = "meeting" order by created desc limit 5}}
- [[{{name}}]]
{{/each}}

## 📌 Pinned
- [[Lab/Wiki/index]] — Lab Wiki
- [[Research/NDD/index]] — NDD Research
- [[Teaching/index]] — Teaching
```

---

## Migration Steps

1. **Copy** all `.md` files preserving folder structure (skip `.obsidian/`, `.makemd/`, `.space/`, `.canvas` files)
2. **Rename** folders per the hierarchy above (`LabManagement` → `Lab`, `Research Segments` → `Research`, etc.)
3. **Add** `SETTINGS.md` and `PLUGS.md` at root
4. **Convert** GitLab wiki `.git` repos to git subtrees
5. **Replace** Dataview code blocks with SilverBullet query syntax
6. **Migrate** Templater templates to SilverBullet template format (in `template/`)
7. **Remove** `.space/def.json` and Make.md artifacts
8. **Add** an `index.md` at each major folder level as a landing page

---

## SilverBullet Plugs to Install (`PLUGS.md`)

```markdown
- [[!silverbullet.md/plug/git]]        # Git integration
- [[!silverbullet.md/plug/tasks]]      # Task tracking
- [[!silverbullet.md/plug/share]]      # Share pages
- [[!silverbullet.md/plug/toc]]        # Table of contents
- [[!silverbullet.md/plug/template]]   # Template system
```
