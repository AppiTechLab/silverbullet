import { emojiMap } from "../codemirror/emojiList.ts";
import type { Tab } from "../types/ui.ts";

const PAGE_EMOJI_RE = /^(:[a-z0-9_+-]+:)\s*/;

export interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
}

export function TabBar(
  { tabs, activeTabId, onActivate, onClose, onNew }: TabBarProps,
) {
  return (
    <div id="sb-tab-bar">
      {tabs.map((tab) => {
        const shortName = tab.pageName.split("/").pop() ?? tab.pageName;
        const emojiMatch = shortName.match(PAGE_EMOJI_RE);
        const emoji = emojiMatch ? emojiMap[emojiMatch[1]] : null;
        const label = emoji
          ? shortName.slice(emojiMatch![0].length) || shortName
          : shortName;
        const isActive = tab.id === activeTabId;

        return (
          <div
            key={tab.id}
            className={`sb-tab${isActive ? " active" : ""}`}
            title={tab.pageName}
            onClick={() => onActivate(tab.id)}
            role="tab"
          >
            {emoji
              ? <span className="sb-tab-icon">{emoji}</span>
              : <i className="ti ti-file-text sb-tab-icon" />}
            <span className="sb-tab-label">{label}</span>
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
      })}
      <button
        className="sb-tab-new"
        title="New tab (Ctrl+T)"
        onClick={onNew}
      >
        <i className="ti ti-plus" />
      </button>
    </div>
  );
}
