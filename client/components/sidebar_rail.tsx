import type { ActiveSection } from "../types/ui.ts";
import type { FolderMeta } from "../lib/folder_icon.ts";

type NavItem = {
  id: ActiveSection;
  icon: string;
  title: string;
};

const TOP_ITEMS: NavItem[] = [
  { id: "recent", icon: "history",    title: "Recent"    },
  { id: "pages",  icon: "files",      title: "All pages" },
  { id: "search", icon: "search",     title: "Search"    },
  { id: "tags",   icon: "tag",        title: "Tags"      },
  { id: "tasks",  icon: "terminal-2", title: "Run command" },
];

const MID_ITEMS: NavItem[] = [
  { id: "templates",   icon: "template",  title: "Templates"   },
  { id: "attachments", icon: "paperclip", title: "Attachments" },
];

type Props = {
  activeSection: ActiveSection;
  onSectionChange: (section: ActiveSection) => void;
  categories: FolderMeta[];
  isAdmin?: boolean;
  showToc: boolean;
  onToggleToc: () => void;
  darkMode?: boolean;
  onToggleDarkMode: () => void;
};

export function SidebarRail(
  {
    activeSection,
    onSectionChange,
    categories,
    isAdmin,
    showToc,
    onToggleToc,
    darkMode,
    onToggleDarkMode,
  }: Props,
) {
  return (
    <div id="sb-icon-rail">
      <div className="sb-rail-logo">
        <i className="ti ti-bolt" />
      </div>

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

      {TOP_ITEMS.map((item) => (
        <button
          key={item.id}
          className={`sb-rail-btn${activeSection === item.id ? " active" : ""}`}
          title={item.title}
          onClick={() => onSectionChange(activeSection === item.id ? "pages" : item.id)}
        >
          <i className={`ti ti-${item.icon}`} />
        </button>
      ))}

      <div className="sb-rail-divider" />

      {MID_ITEMS.map((item) => (
        <button
          key={item.id}
          className={`sb-rail-btn${activeSection === item.id ? " active" : ""}`}
          title={item.title}
          onClick={() => onSectionChange(item.id)}
        >
          <i className={`ti ti-${item.icon}`} />
        </button>
      ))}

      <div className="sb-rail-spacer" />

      {isAdmin && (
        <button
          className={`sb-rail-btn${activeSection === "permissions" ? " active" : ""}`}
          title="Permissions"
          onClick={() => onSectionChange("permissions")}
        >
          <i className="ti ti-shield" />
        </button>
      )}
      {isAdmin && (
        <button
          className={`sb-rail-btn${activeSection === "users" ? " active" : ""}`}
          title="Users"
          onClick={() => onSectionChange("users")}
        >
          <i className="ti ti-users" />
        </button>
      )}
      <button
        className={`sb-rail-btn${showToc ? " active" : ""}`}
        title="Table of Contents"
        onClick={onToggleToc}
      >
        <i className="ti ti-list" />
      </button>
      <button
        className="sb-rail-btn"
        title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
        onClick={onToggleDarkMode}
      >
        <i className={`ti ti-${darkMode ? "sun" : "moon"}`} />
      </button>
      <button className="sb-rail-btn" title="Settings">
        <i className="ti ti-settings" />
      </button>
      <button
        className="sb-rail-btn"
        title="Log out"
        onClick={() => {
          if (confirm("Log out?")) {
            location.href = ".logout";
          }
        }}
      >
        <i className="ti ti-user-circle" />
      </button>
    </div>
  );
}
