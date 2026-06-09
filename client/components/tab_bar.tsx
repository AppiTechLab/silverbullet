import { useState } from "preact/hooks";
import { emojiMap } from "../codemirror/emojiList.ts";
import type { Tab } from "../types/ui.ts";

const PAGE_EMOJI_RE = /^(:[a-z0-9_+-]+:)\s*/;

export interface TabBarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNew: () => void;
  onRename: (tabId: string, newPageName: string) => Promise<void>;
}

export function TabBar(
  { tabs, activeTabId, onActivate, onClose, onNew, onRename }: TabBarProps,
) {
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const startRename = (tab: Tab) => {
    if (tab.id !== activeTabId) {
      onActivate(tab.id);
      return;
    }
    setRenamingTabId(tab.id);
    setRenameValue(tab.pageName);
  };

  const commitRename = async (tabId: string) => {
    const newName = renameValue.trim();
    setRenamingTabId(null);
    setRenameValue("");
    if (!newName) return;
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || newName === tab.pageName) return;
    await onRename(tabId, newName);
  };

  const cancelRename = () => {
    setRenamingTabId(null);
    setRenameValue("");
  };

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
        const isRenaming = renamingTabId === tab.id;

        return (
          <div
            key={tab.id}
            className={`sb-tab${isActive ? " active" : ""}${isRenaming ? " renaming" : ""}`}
            title={isRenaming ? undefined : tab.pageName}
            onClick={() => {
              if (renamingTabId) return;
              onActivate(tab.id);
            }}
            onDblClick={() => startRename(tab)}
            role="tab"
          >
            {emoji
              ? <span className="sb-tab-icon">{emoji}</span>
              : <i className="ti ti-file-text sb-tab-icon" />}

            {isRenaming
              ? (
                <input
                  autoFocus
                  className="sb-tab-rename-input"
                  value={renameValue}
                  onInput={(e) =>
                    setRenameValue((e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitRename(tab.id);
                    }
                    if (e.key === "Escape") cancelRename();
                  }}
                  onBlur={() => setTimeout(cancelRename, 100)}
                  onClick={(e) => e.stopPropagation()}
                  onDblClick={(e) => e.stopPropagation()}
                />
              )
              : <span className="sb-tab-label">{label}</span>}

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
