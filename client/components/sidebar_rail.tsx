import type { ActiveSection } from "../types/ui.ts";

type NavItem = {
  id: ActiveSection;
  icon: string;
  title: string;
};

const TOP_ITEMS: NavItem[] = [
  { id: "pages", icon: "files", title: "Pages" },
  { id: "search", icon: "search", title: "Search" },
  { id: "tags", icon: "tag", title: "Tags" },
  { id: "tasks", icon: "list-check", title: "Tasks" },
];

const MID_ITEMS: NavItem[] = [
  { id: "templates", icon: "template", title: "Templates" },
  { id: "attachments", icon: "paperclip", title: "Attachments" },
];

type Props = {
  activeSection: ActiveSection;
  onSectionChange: (section: ActiveSection) => void;
};

export function SidebarRail({ activeSection, onSectionChange }: Props) {
  return (
    <div id="sb-icon-rail">
      <div className="sb-rail-logo">
        <i className="ti ti-bolt" />
      </div>

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

      <button className="sb-rail-btn" title="Settings">
        <i className="ti ti-settings" />
      </button>
      <button className="sb-rail-btn" title="User">
        <i className="ti ti-user-circle" />
      </button>
    </div>
  );
}
