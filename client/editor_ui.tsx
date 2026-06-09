import { Confirm, Prompt } from "./components/basic_modals.tsx";
import {
  CommandPalette,
  keyboardHint,
} from "./components/command_palette.tsx";
import { FilterList } from "./components/filter.tsx";
import { AnythingPicker } from "./components/anything_picker.tsx";
import { TopBar } from "./components/top_bar.tsx";
import { SidebarRail } from "./components/sidebar_rail.tsx";
import { SidebarNav } from "./components/sidebar_nav.tsx";
import { TabBar } from "./components/tab_bar.tsx";
import { Toc } from "./components/toc.tsx";
import { extractHeadings, type Heading } from "./codemirror/toc.ts";
import { Breadcrumbs } from "./components/breadcrumbs.tsx";
import { Toolbar } from "./components/toolbar.tsx";
import { topLevelFolders, parseFolderMeta, type FolderMeta } from "./lib/folder_icon.ts";
import reducer from "./reducer.ts";
import {
  type Action,
  type AppViewState,
  initialViewState,
} from "./types/ui.ts";
import * as featherIcons from "preact-feather";
import * as mdi from "./filtered_material_icons.ts";
import { h, render as preactRender } from "preact";
import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import { EditorView } from "@codemirror/view";
import { closeSearchPanel } from "@codemirror/search";
import { runScopeHandlers } from "@codemirror/view";
import type { Client } from "./client.ts";
import { Panel } from "./components/panel.tsx";
import { safeRun } from "@silverbulletmd/silverbullet/lib/async";
import type {
  FilterOption,
  NotificationAction,
  NotificationType,
} from "@silverbulletmd/silverbullet/type/client";
import { notificationDismissTimeouts } from "@silverbulletmd/silverbullet/type/client";
import {
  getNameFromPath,
  getPathExtension,
  isMarkdownPath,
  isValidName,
  parseToRef,
  type Path,
} from "@silverbulletmd/silverbullet/lib/ref";

export class MainUI {
  viewState: AppViewState = initialViewState;
  // Scroll position to restore after a tab-switch navigation completes
  pendingScrollRestore: number | null = null;
  // When true, the next page-loaded event opens a new tab instead of updating the current one
  pendingNewTab = false;
  // Called by tocPlugin (registered in editor_state.ts) whenever headings change
  headingsChangeCallback: ((h: Heading[]) => void) | null = null;

  constructor(private client: Client) {
    // Make keyboard shortcuts work even when the editor is in read only mode or not focused
    globalThis.addEventListener("keydown", (ev) => {
      // Tab bar keyboard shortcuts (work regardless of editor focus)
      const withMod = ev.ctrlKey || ev.metaKey;
      if (withMod && !ev.altKey) {
        const { tabs, activeTabId } = this.viewState;
        if (ev.key === "w" && tabs.length > 0 && activeTabId) {
          ev.preventDefault();
          const idx = tabs.findIndex((t) => t.id === activeTabId);
          const remaining = tabs.filter((t) => t.id !== activeTabId);
          this.viewDispatch({ type: "tab-close", tabId: activeTabId });
          if (remaining.length > 0) {
            const next = remaining[Math.min(idx, remaining.length - 1)];
            this.pendingScrollRestore = next.scrollTop;
            const ref = parseToRef(next.pageName);
            if (ref) void client.navigate(ref);
          }
          return;
        }
        if (ev.key === "Tab" && tabs.length > 1) {
          ev.preventDefault();
          const idx = tabs.findIndex((t) => t.id === activeTabId);
          const nextIdx = ev.shiftKey
            ? (idx - 1 + tabs.length) % tabs.length
            : (idx + 1) % tabs.length;
          const next = tabs[nextIdx];
          this.viewDispatch({ type: "tab-activate", tabId: next.id });
          this.pendingScrollRestore = next.scrollTop;
          const ref = parseToRef(next.pageName);
          if (ref) void client.navigate(ref);
          return;
        }
        if (ev.key === "t" && !ev.shiftKey) {
          ev.preventDefault();
          this.pendingNewTab = true;
          client.startPageNavigate("all");
          return;
        }
      }

      if (!client.editorView.hasFocus) {
        const target = ev.target as HTMLElement;
        if (target.className === "cm-textfield" && ev.key === "Escape") {
          // Search panel is open, let's close it
          console.log("Closing search panel");
          closeSearchPanel(client.editorView);
          return;
        } else if (
          target.className === "cm-textfield" ||
          target.closest(".cm-content") ||
          target.closest(".cm-vim-panel")
        ) {
          // In some cm element, let's back out
          return;
        } else if (
          target.closest('input, textarea, select, [contenteditable="true"]')
        ) {
          // Focus is in a native form field (e.g. the top-bar page-name
          // editor). Let the field own keys it handles natively — typing,
          // caret navigation, and the standard clipboard/undo/select-all
          // combos — but still forward genuine command shortcuts (e.g. Cmd-K)
          // so they keep working from the field, like they did in the old
          // CodeMirror mini-editor.
          const cmd = ev.metaKey || ev.ctrlKey;
          const key = ev.key.toLowerCase();
          const fieldHandlesNatively = !cmd ||
            ["a", "c", "v", "x", "z", "y"].includes(key) ||
            [
              "arrowleft",
              "arrowright",
              "arrowup",
              "arrowdown",
              "home",
              "end",
              "backspace",
              "delete",
            ].includes(key);
          if (fieldHandlesNatively) {
            return;
          }
          // Otherwise fall through and forward the shortcut to the editor.
        }
        if (runScopeHandlers(client.editorView, ev, "editor")) {
          ev.preventDefault();
        }
      }
    });

    globalThis.addEventListener("touchstart", (ev) => {
      // Launch the page picker on a two-finger tap
      if (ev.touches.length === 2) {
        ev.stopPropagation();
        ev.preventDefault();
        client.startPageNavigate("page");
      }
      // Launch the command palette using a three-finger tap
      if (ev.touches.length === 3) {
        ev.stopPropagation();
        ev.preventDefault();
        void client.startCommandPalette();
      }
    });

    globalThis.addEventListener("mouseup", (_) => {
      setTimeout(() => {
        client.editorView.dispatch({});
      });
    });
  }

  // Progress circle handling
  private progressTimeout?: ReturnType<typeof setTimeout>;

  viewDispatch: (action: Action) => void = () => { };

  flashNotification(
    message: string,
    type: NotificationType = "info",
    options?: {
      timeout?: number;
      actions?: NotificationAction[];
    },
  ) {
    const id = Math.floor(Math.random() * 1000000);
    const dismiss = () => {
      this.viewDispatch({ type: "dismiss-notification", id });
    };
    const persistent = options?.timeout === 0;
    const actions = options?.actions?.map((action) => ({
      name: action.name,
      run: () => {
        action.run();
        dismiss();
      },
    }));
    this.viewDispatch({
      type: "show-notification",
      notification: {
        id,
        type,
        message,
        date: new Date(),
        actions,
        persistent,
      },
    });
    if (!persistent) {
      const timeout = options?.timeout ?? notificationDismissTimeouts[type];
      setTimeout(dismiss, timeout);
    }
  }

  showProgress(progressPercentage?: number, progressType?: "sync" | "index") {
    this.viewDispatch({
      type: "set-progress",
      progressPercentage,
      progressType,
    });
    if (this.progressTimeout) {
      clearTimeout(this.progressTimeout);
    }
    this.progressTimeout = setTimeout(() => {
      this.viewDispatch({
        type: "set-progress",
      });
    }, 5000);
  }

  filterBox(
    label: string,
    options: FilterOption[],
    helpText = "",
    placeHolder = "",
  ): Promise<FilterOption | undefined> {
    return new Promise((resolve) => {
      this.viewDispatch({
        type: "show-filterbox",
        label,
        options,
        placeHolder,
        helpText,
        onSelect: (option: any) => {
          this.viewDispatch({ type: "hide-filterbox" });
          this.client.focus();
          resolve(option);
        },
      });
    });
  }

  prompt(message: string, defaultValue = ""): Promise<string | undefined> {
    return new Promise((resolve) => {
      this.viewDispatch({
        type: "show-prompt",
        message,
        defaultValue,
        callback: (value: string | undefined) => {
          this.viewDispatch({ type: "hide-prompt" });
          this.client.focus();
          resolve(value);
        },
      });
    });
  }

  confirm(
    message: string,
    options?: { destructive?: boolean },
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.viewDispatch({
        type: "show-confirm",
        message,
        destructive: options?.destructive,
        callback: (value: boolean) => {
          this.viewDispatch({ type: "hide-confirm" });
          this.client.focus();
          resolve(value);
        },
      });
    });
  }

  ViewComponent() {
    const [viewState, dispatch] = useReducer(reducer, initialViewState);
    this.viewState = viewState;
    this.viewDispatch = dispatch;

    const client = this.client;

    useEffect(() => {
      if (viewState.current) {
        document.title =
          (this.client.currentPageMeta()?.pageDecoration?.prefix ?? "") +
          getNameFromPath(viewState.current.path);
      }
    }, [viewState.current]);

    useEffect(() => {
      void this.client.rebuildEditorState();
      void this.client.dispatchAppEvent("editor:modeswitch");
    }, [viewState.uiOptions.vimMode]);

    useEffect(() => {
      const updateTheme = () => {
        const darkMode =
          viewState.uiOptions.darkMode === undefined
            ? globalThis.matchMedia("(prefers-color-scheme: dark)").matches
            : viewState.uiOptions.darkMode;

        document.documentElement.dataset.theme = darkMode ? "dark" : "light";

        if (this.client.contentManager.isDocumentEditor()) {
          this.client.contentManager.documentEditor.updateTheme();
        }
      };

      updateTheme();

      if (viewState.uiOptions.darkMode === undefined) {
        const mediaQuery = globalThis.matchMedia(
          "(prefers-color-scheme: dark)",
        );
        mediaQuery.addEventListener("change", updateTheme);

        return () => {
          mediaQuery.removeEventListener("change", updateTheme);
        };
      }
    }, [viewState.uiOptions.darkMode]);

    useEffect(() => {
      document.documentElement.dataset.markdownSyntaxRendering = viewState
        .uiOptions.markdownSyntaxRendering
        ? "on"
        : "off";
    }, [viewState.uiOptions.markdownSyntaxRendering]);

    useEffect(() => {
      // Need to dispatch a resize event so that the top_bar can pick it up
      globalThis.dispatchEvent(new Event("resize"));
    }, [viewState.panels]);
    useEffect(() => {
      if (viewState.activeSection === "search") {
        client.startPageNavigate("all");
        dispatch({ type: "set-active-section", section: "pages" });
      }
    }, [viewState.activeSection]);

    const categories: FolderMeta[] = topLevelFolders(viewState.allPages)
      .map(parseFolderMeta)
      .filter((c) => c.icon !== "");

    useEffect(() => {
      if (
        categories.length > 0 &&
        !viewState.activeSection.startsWith("category:")
      ) {
        dispatch({
          type: "set-active-section",
          section: `category:${categories[0].prefix}`,
        });
      }
    }, [categories.length]);

    const [headings, setHeadings] = useState<Heading[]>([]);
    const [activeHeading, setActiveHeading] = useState(-1);
    const headingsRef = useRef<Heading[]>([]);

    const [allTagNames, setAllTagNames] = useState<string[]>([]);
    useEffect(() => {
      safeRun(async () => {
        try {
          const tagObjects: any[] = await client.clientSystem.system
            .localSyscall("index.queryLuaObjects", ["tag", {}]);
          const names = [
            ...new Set(tagObjects.map((t) => t.name as string)),
          ].sort();
          setAllTagNames(names);
        } catch {
          // index not ready yet
        }
      });
    }, [viewState.allPages]);

    // Register Ctrl+Click new-tab handler once on mount
    useEffect(() => {
      client.onOpenInNewTab = (pageName) => {
        dispatch({ type: "tab-open", pageName });
        const ref = parseToRef(pageName);
        if (ref) void client.navigate(ref);
      };
      return () => { client.onOpenInNewTab = undefined; };
    }, []);

    // Wire up the headings callback — tocPlugin in editor_state.ts calls this.
    // Also extract immediately in case the plugin constructor fired before this ran.
    useEffect(() => {
      this.headingsChangeCallback = (h) => {
        headingsRef.current = h;
        setHeadings(h);
      };
      const h = extractHeadings(client.editorView.state);
      headingsRef.current = h;
      setHeadings(h);
      return () => { this.headingsChangeCallback = null; };
    }, []);

    // Attach scroll tracker: immediate for TOC active heading, debounced 500ms for tab save
    useEffect(() => {
      const scrollEl = client.editorView.scrollDOM;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const onScroll = () => {
        const scrollTop = scrollEl.scrollTop;
        const hs = headingsRef.current;
        let activeIdx = -1;
        for (let i = 0; i < hs.length; i++) {
          try {
            const block = client.editorView.lineBlockAt(hs[i].from);
            if (block.top <= scrollTop + 50) activeIdx = i;
            else break;
          } catch {
            // position out of range during doc change
          }
        }
        setActiveHeading(activeIdx);

        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          const { activeTabId } = this.viewState;
          if (activeTabId) {
            dispatch({
              type: "tab-update-scroll",
              tabId: activeTabId,
              scrollTop: scrollEl.scrollTop,
            });
          }
        }, 500);
      };
      scrollEl.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        scrollEl.removeEventListener("scroll", onScroll);
        if (timer) clearTimeout(timer);
      };
    }, []);

    // Sync tabs with the currently loaded page
    useEffect(() => {
      if (!viewState.current) return;
      const pageName = getNameFromPath(viewState.current.path);
      if (!pageName) return;

      // Restore scroll if a tab-switch triggered this navigation
      if (this.pendingScrollRestore !== null) {
        const scroll = this.pendingScrollRestore;
        this.pendingScrollRestore = null;
        requestAnimationFrame(() => {
          client.editorView.scrollDOM.scrollTop = scroll;
        });
      }

      const { tabs, activeTabId } = viewState;
      const activeTab = tabs.find((t) => t.id === activeTabId);

      // + button or Ctrl+T requested a new tab for the next navigation
      if (this.pendingNewTab) {
        this.pendingNewTab = false;
        dispatch({ type: "tab-open", pageName });
        return;
      }

      if (!activeTab) {
        dispatch({ type: "tab-open", pageName });
        return;
      }
      if (activeTab.pageName === pageName) return;

      const matchingTab = tabs.find((t) => t.pageName === pageName);
      if (matchingTab) {
        dispatch({ type: "tab-activate", tabId: matchingTab.id });
      } else {
        dispatch({ type: "tab-activate-page", tabId: activeTab.id, pageName });
      }
    }, [viewState.current]);

    // Mirror unsaved-changes state onto the active tab
    useEffect(() => {
      const { activeTabId } = viewState;
      if (activeTabId) {
        dispatch({
          type: "tab-mark-unsaved",
          tabId: activeTabId,
          unsaved: viewState.unsavedChanges,
        });
      }
    }, [viewState.unsavedChanges]);

    const actionButtons = client.config.get<ActionButton[]>(
      "actionButtons",
      [],
    );

    const currentPageName = viewState.current
      ? getNameFromPath(viewState.current.path)
      : "";
    return (
      <>
        {viewState.showPageNavigator && (
          <AnythingPicker
            allDocuments={viewState.allDocuments}
            allPages={viewState.allPages}
            extensions={
              new Set(
                Array.from(
                  client.clientSystem.documentEditorHook.documentEditors.values(),
                ).flatMap(({ extensions }) => extensions),
              )
            }
            currentPath={client.currentPath()}
            mode={viewState.pageNavigatorMode}
            darkMode={viewState.uiOptions.darkMode}
            onModeSwitch={(mode) => {
              dispatch({ type: "stop-navigate" });
              setTimeout(() => {
                dispatch({ type: "start-navigate", mode });
              });
            }}
            onNavigate={(name) => {
              dispatch({ type: "stop-navigate" });
              setTimeout(() => {
                client.focus();
              });

              if (!name) {
                return;
              }

              safeRun(async () => {
                const ref = parseToRef(name);

                // Check beforhand, because we don't want to allow any link
                // stuff like #header here. The `!ref` check is just for
                // Typescript
                if (!isValidName(name) || !ref) {
                  // It's not a valid name so either, the user tried to create a
                  // page or we have an invalid file in the space. Names are
                  // only unique for files which follow our rules, so we are
                  // kind of in unknown territory now.

                  if (client.clientSystem.allKnownFiles.has(name)) {
                    // Try it as a document name === path
                    await this.promptDocumentOperation(
                      name as Path,
                      `'${name}' has an invalid name. You can now modify it`,
                    );
                  } else if (
                    client.clientSystem.allKnownFiles.has(`${name}.md`)
                  ) {
                    // Try it as a page
                    await this.promptDocumentOperation(
                      `${name}.md`,
                      `'${name}.md' has an invalid name. You can now modify it`,
                    );
                  } else {
                    this.flashNotification(
                      `Couldn't create page ${name}, name is invalid`,
                      "error",
                    );
                  }

                  return;
                }

                if (
                  !isMarkdownPath(ref.path) &&
                  !Array.from(
                    client.clientSystem.documentEditorHook.documentEditors.values(),
                  ).some(({ extensions }) =>
                    extensions.includes(getPathExtension(ref.path)),
                  )
                ) {
                  await this.promptDocumentOperation(
                    ref.path,
                    "This file cannot be edited, select your desired action.",
                  );
                } else {
                  void client.navigate(ref);
                }
              });
            }}
          />
        )}
        {viewState.showCommandPalette && (
          <CommandPalette
            onTrigger={(cmd) => {
              safeRun(async () => {
                dispatch({ type: "hide-palette" });
                if (cmd) {
                  await this.client.registerCommandRun(cmd.name);
                  try {
                    const returnValue = await cmd.run!();
                    if (returnValue !== false) {
                      client.focus();
                    }
                  } catch (e: any) {
                    this.client.reportError(e, "Command invocation");
                  }
                } else {
                  setTimeout(() => client.focus());
                }
              });
            }}
            commands={client.getCommandsByContext(viewState)}
            darkMode={viewState.uiOptions.darkMode}
          />
        )}
        {viewState.showFilterBox && (
          <FilterList
            label={viewState.filterBoxLabel}
            placeholder={viewState.filterBoxPlaceHolder}
            options={viewState.filterBoxOptions}
            darkMode={viewState.uiOptions.darkMode}
            allowNew={false}
            helpText={viewState.filterBoxHelpText}
            onSelect={viewState.filterBoxOnSelect}
          />
        )}
        {viewState.showPrompt && (
          <Prompt
            message={viewState.promptMessage!}
            defaultValue={viewState.promptDefaultValue}
            darkMode={viewState.uiOptions.darkMode}
            callback={(value) => {
              dispatch({ type: "hide-prompt" });
              viewState.promptCallback!(value);
            }}
          />
        )}
        {viewState.showConfirm && (
          <Confirm
            message={viewState.confirmMessage!}
            destructive={viewState.confirmDestructive}
            callback={(value) => {
              dispatch({ type: "hide-confirm" });
              viewState.confirmCallback!(value);
            }}
          />
        )}
        <SidebarRail
          activeSection={viewState.activeSection}
          onSectionChange={(section) =>
            dispatch({ type: "set-active-section", section })}
          categories={categories}
          isAdmin={client.bootConfig.isAdmin ?? false}
          showToc={viewState.showToc}
          onToggleToc={() => dispatch({ type: "toggle-toc" })}
        />
        <SidebarNav
          activeSection={viewState.activeSection}
          currentPage={currentPageName}
          currentUser={client.bootConfig.currentUser ?? ""}
          pages={viewState.allPages}
          tags={allTagNames}
          onPageSelect={(name) => {
            const ref = parseToRef(name);
            if (ref) void client.navigate(ref);
          }}
          onTagSelect={(tagPage) => {
            const ref = parseToRef(tagPage);
            if (ref) void client.navigate(ref);
          }}
          onSearch={() => {
            client.startPageNavigate("all");
            dispatch({ type: "set-active-section", section: "pages" });
          }}
          onNewPage={() => void client.startCommandPalette()}
        />
        <div id="sb-editor-area">
          <div id="sb-editor-column">
          {viewState.uiOptions.showTopBar && (
            <TopBar
              pageName={
                !viewState.current ? "" : getNameFromPath(viewState.current.path)
              }
              notifications={viewState.notifications}
              onDismissNotification={(id) => {
                dispatch({ type: "dismiss-notification", id });
              }}
              isOnline={viewState.isOnline}
              unsavedChanges={viewState.unsavedChanges}
              isLoading={viewState.isLoading}
              progressPercentage={viewState.progressPercentage}
              progressType={viewState.progressType}
              onRename={async (newName) => {
                if (client.contentManager.isDocumentEditor()) {
                  if (!newName) return;

                  console.log("Now renaming document to...", newName);
                  await client.clientSystem.system.invokeFunction(
                    "index.renameDocumentCommand",
                    [{ document: newName }],
                  );
                } else {
                  if (!newName) {
                    client.editorView.dispatch({
                      selection: { anchor: 0 },
                    });
                    client.focus();
                    return;
                  }
                  console.log("Now renaming page to...", newName);
                  await client.clientSystem.system.invokeFunction(
                    "index.renamePageCommand",
                    [{ page: newName }],
                  );
                  client.focus();
                }
              }}
              actionButtons={[
                ...(viewState.isMobile &&
                  client.config
                    .get<string>("mobileMenuStyle", "hamburger")
                    .includes("hamburger")
                  ? [
                    {
                      icon: featherIcons.Menu,
                      description: "Open Menu",
                      class: "expander",
                      callback: () => {
                        document
                          .querySelector("#sb-top .sb-actions.hamburger")
                          ?.classList.toggle("open");
                      },
                    },
                  ]
                  : []),
                ...actionButtons
                  .filter((button) =>
                    button.icon &&
                    (typeof button.mobile === "undefined" ||
                      button.mobile === viewState.isMobile) &&
                    (typeof button.standalone === "undefined" ||
                      button.standalone === viewState.isStandalone)
                  )
                  .map((button, index) => ({
                    ...button,
                    priority: button.priority ?? actionButtons.length - index,
                  }))
                  .sort((a, b) => b.priority - a.priority)
                  .map((button) => {
                    const mdiIcon = (mdi as any)[kebabToCamel(button.icon)];
                    let featherIcon = (featherIcons as any)[
                      kebabToCamel(button.icon)
                    ];
                    if (!featherIcon) featherIcon = featherIcons.HelpCircle;
                    let description = button.description || "";
                    if (button.command) {
                      const cmd = viewState.commands.get(button.command);
                      if (cmd) {
                        const hint = keyboardHint(cmd);
                        if (hint) {
                          description = description
                            ? `${description} (${hint})`
                            : hint;
                        }
                      }
                    }
                    return {
                      icon: mdiIcon ? mdiIcon : featherIcon,
                      description,
                      dropdown: button.dropdown,
                      callback: button.command
                        ? () => this.client.runCommandByName(button.command!)
                        : button.run ||
                        (() => {
                          this.flashNotification(
                            "actionButton did not specify a command or run() callback",
                            "error",
                          );
                        }),
                      href: "",
                    };
                  }),
              ]}
              rhs={
                !!viewState.panels.rhs.mode && (
                  <div
                    className="panel"
                    style={{ flex: viewState.panels.rhs.mode }}
                  />
                )
              }
              lhs={
                !!viewState.panels.lhs.mode && (
                  <div
                    className="panel"
                    style={{ flex: viewState.panels.lhs.mode }}
                  />
                )
              }
              pageNamePrefix={
                client.currentPageMeta()?.pageDecoration?.prefix ?? ""
              }
              cssClass={(client.currentPageMeta()?.pageDecoration?.cssClasses ??
                [])
                .join(" ")
                .replaceAll(/[^a-zA-Z0-9-_ ]/g, "")}
              mobileMenuStyle={viewState.isMobile
                ? client.config.get<string>("mobileMenuStyle", "hamburger")
                : undefined}
              readOnly={
                viewState.uiOptions.forcedROMode || client.bootConfig.readOnly
              }
            />
          )}
          <TabBar
            tabs={viewState.tabs}
            activeTabId={viewState.activeTabId}
            onActivate={(tabId) => {
              const tab = viewState.tabs.find((t) => t.id === tabId);
              if (!tab) return;
              this.pendingScrollRestore = tab.scrollTop;
              dispatch({ type: "tab-activate", tabId });
              const ref = parseToRef(tab.pageName);
              if (ref) void client.navigate(ref);
            }}
            onClose={(tabId) => {
              const { tabs, activeTabId } = viewState;
              const idx = tabs.findIndex((t) => t.id === tabId);
              const remaining = tabs.filter((t) => t.id !== tabId);
              dispatch({ type: "tab-close", tabId });
              if (tabId === activeTabId && remaining.length > 0) {
                const next = remaining[Math.min(idx, remaining.length - 1)];
                this.pendingScrollRestore = next.scrollTop;
                const ref = parseToRef(next.pageName);
                if (ref) void client.navigate(ref);
              }
            }}
            onNew={() => {
              this.pendingNewTab = true;
              client.startPageNavigate("all");
            }}
          />
          <Breadcrumbs
            pageName={currentPageName}
            onNavigate={(page) => {
              const ref = parseToRef(page);
              if (ref) void client.navigate(ref);
            }}
          />
          <Toolbar
            editorView={client.editorView}
            readOnly={
              viewState.uiOptions.forcedROMode || client.bootConfig.readOnly
            }
          />
          <div id="sb-main">
            {viewState.panels.lhs.mode !== undefined && (
              <Panel config={viewState.panels.lhs} editor={client} />
            )}
            <div id="sb-editor" />
            {viewState.panels.rhs.mode !== undefined && (
              <Panel config={viewState.panels.rhs} editor={client} />
            )}
          </div>
          {viewState.panels.modal.mode !== undefined && (
            <div className="sb-modal-backdrop">
              <div
                className="sb-modal"
                style={{ inset: `${viewState.panels.modal.mode}px` }}
              >
                <Panel config={viewState.panels.modal} editor={client} />
              </div>
            </div>
          )}
          {viewState.panels.bhs.mode !== undefined && (
            <div className="sb-bhs">
              <Panel config={viewState.panels.bhs} editor={client} />
            </div>
          )}
          </div>
          {viewState.showToc && (
            <Toc
              headings={headings}
              activeHeading={activeHeading}
              onHeadingClick={(from) => {
                client.editorView.dispatch({
                  effects: EditorView.scrollIntoView(from, {
                    y: "start",
                    yMargin: 80,
                  }),
                });
                client.editorView.focus();
              }}
            />
          )}
        </div>
      </>
    );
  }

  render(container: Element) {
    // const ViewComponent = this.ui.ViewComponent.bind(this.ui);
    container.innerHTML = "";
    preactRender(h(this.ViewComponent.bind(this), {}), container);
  }

  async promptDocumentOperation(path: Path, msg: string) {
    const options: string[] = ["View", "Delete", "Rename"];

    const option = await this.filterBox(
      "Modify",
      options.map((x) => ({ name: x }) as FilterOption),
      msg,
    );
    if (!option) return;

    switch (option.name) {
      case "View": {
        await this.client.navigate({ path: path });
        break;
      }
      case "Delete": {
        if (
          await this.confirm(
            `Are you sure you would like delete ${getNameFromPath(path)}?`,
            { destructive: true },
          )
        ) {
          if (isMarkdownPath(path)) {
            await this.client.space.deletePage(getNameFromPath(path));
          } else {
            await this.client.space.deleteDocument(getNameFromPath(path));
          }
        }
        break;
      }
      case "Rename": {
        if (isMarkdownPath(path)) {
          await this.client.clientSystem.system.invokeFunction(
            "index.renamePageCommand",
            [{ oldPage: getNameFromPath(path) }],
          );
        } else {
          await this.client.clientSystem.system.invokeFunction(
            "index.renameDocumentCommand",
            [{ oldDocument: getNameFromPath(path) }],
          );
        }
        break;
      }
    }
  }
}

// TODO: Parking this here for now, this is very similar to the definition in top_bar.tsx

type ActionButton = {
  icon: string;
  description?: string;
  command?: string;
  mobile?: boolean;
  standalone?: boolean;
  dropdown?: boolean;
  priority?: number;
  run?: () => void;
};


function kebabToCamel(str: string) {
  return str
    .replace(/-([a-z])/g, (g) => g[1].toUpperCase())
    .replace(/^./, (g) => g.toUpperCase());
}
