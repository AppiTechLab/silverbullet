import { useState } from "preact/hooks";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { emojiMap } from "../codemirror/emojiList.ts";

const PAGE_EMOJI_RE = /^(:[a-z0-9_+-]+:)\s*/;

function parsePageTitle(name: string): { icon: string | null; title: string } {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const match = base.match(PAGE_EMOJI_RE);
  if (match) {
    const emoji = emojiMap[match[1]];
    if (emoji) {
      return { icon: emoji, title: base.slice(match[0].length) || base };
    }
  }
  return { icon: null, title: base };
}

export interface SidebarNavProps {
  activeSection: string;
  currentPage: string;
  pages: PageMeta[];
  tags: string[];
  onPageSelect: (page: string) => void;
  onTagSelect: (tagPage: string) => void;
  onSearch: () => void;
  onNewPage: () => void;
}

type TagNode = { name: string; children: TagNode[] };

function topCollection(pageName: string): string {
  const i = pageName.indexOf("/");
  return i === -1 ? "" : pageName.slice(0, i);
}

function buildTagTree(tags: string[]): TagNode[] {
  const groups = new Map<string, string[]>();
  for (const tag of tags) {
    const slash = tag.indexOf("/");
    if (slash === -1) {
      if (!groups.has(tag)) groups.set(tag, []);
    } else {
      const parent = tag.slice(0, slash);
      const rest = tag.slice(slash + 1);
      if (!groups.has(parent)) groups.set(parent, []);
      groups.get(parent)!.push(rest);
    }
  }
  return Array.from(groups.entries()).map(([name, childTags]) => ({
    name,
    children: buildTagTree(childTags),
  }));
}

export function SidebarNav({
  currentPage,
  pages,
  tags,
  onPageSelect,
  onTagSelect,
  onSearch,
  onNewPage,
}: SidebarNavProps) {
  // Group by top-level folder; "" = root-level pages
  const collections = new Map<string, PageMeta[]>();
  for (const page of pages) {
    const coll = topCollection(page.name);
    if (!collections.has(coll)) collections.set(coll, []);
    collections.get(coll)!.push(page);
  }

  // Sort: root pages first, then folders alphabetically
  const sortedCollections = [
    ...(collections.has("") ? [["", collections.get("")!] as const] : []),
    ...Array.from(collections.entries())
      .filter(([k]) => k !== "")
      .sort(([a], [b]) => a.localeCompare(b)),
  ];

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());

  const toggle = (setter: (fn: (prev: Set<string>) => Set<string>) => void, name: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleCollection = (name: string) => toggle(setExpanded, name);
  const toggleTag = (name: string) => toggle(setExpandedTags, name);

  const tagTree = buildTagTree(tags);

  // Renders a tag node at any depth; `path` is the full slash-joined key for expand state.
  const renderTagNode = (node: TagNode, path: string, depth: number): any => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedTags.has(path);
    return (
      <div key={path}>
        <div
          className="sb-nav-item sb-nav-tag"
          style={{ paddingLeft: `${6 + depth * 14}px` }}
          onClick={() => onTagSelect(`tag:${path}`)}
          role="button"
        >
          {hasChildren
            ? (
              <i
                className={`ti ti-chevron-${
                  isExpanded ? "down" : "right"
                } sb-nav-chevron`}
                onClick={(e) => { e.stopPropagation(); toggleTag(path); }}
              />
            )
            : null}
          <i className="ti ti-hash" />
          <span className="sb-nav-label">{node.name}</span>
          {hasChildren && !isExpanded && (
            <span className="sb-nav-badge">{node.children.length}</span>
          )}
        </div>
        {isExpanded &&
          node.children.map((child) =>
            renderTagNode(child, `${path}/${child.name}`, depth + 1)
          )}
      </div>
    );
  };

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
        <div className="sb-nav-section-label">Pages</div>
        {sortedCollections.map(([coll, collPages]) => {
          if (coll === "") {
            // Root-level pages — render flat, no folder
            return collPages.map((page) => {
              const { icon, title } = parsePageTitle(page.name);
              return (
                <div
                  key={page.name}
                  className={`sb-nav-item sb-nav-page${
                    currentPage === page.name ? " active" : ""
                  }`}
                  onClick={() => onPageSelect(page.name)}
                  role="button"
                >
                  {icon
                    ? <span className="sb-nav-page-emoji">{icon}</span>
                    : <i className="ti ti-file-text" />}
                  <span className="sb-nav-label">{title}</span>
                </div>
              );
            });
          }

          const isExpanded = expanded.has(coll);
          return (
            <div key={coll}>
              <div
                className="sb-nav-item sb-nav-collection"
                onClick={() => toggleCollection(coll)}
                role="button"
              >
                <i
                  className={`ti ti-chevron-${
                    isExpanded ? "down" : "right"
                  } sb-nav-chevron`}
                />
                <i className="ti ti-folder" />
                <span className="sb-nav-label">{coll}</span>
                {!isExpanded && (
                  <span className="sb-nav-badge">{collPages.length}</span>
                )}
              </div>
              {isExpanded &&
                collPages.map((page) => {
                  const { icon, title } = parsePageTitle(page.name);
                  return (
                    <div
                      key={page.name}
                      className={`sb-nav-item sb-nav-page${
                        currentPage === page.name ? " active" : ""
                      }`}
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
            </div>
          );
        })}
      </div>

      {tagTree.length > 0 && (
        <div className="sb-nav-section">
          <div className="sb-nav-section-label">Tags</div>
          {tagTree.map((node) => renderTagNode(node, node.name, 0))}
        </div>
      )}
    </div>
  );
}
