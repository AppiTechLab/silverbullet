import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  decoratorStateField,
  hideBlockSource,
  isCursorInRange,
  LinkWidget,
} from "./util.ts";
import type { Client } from "../client.ts";
import {
  frontmatterMailtoRegex,
  frontmatterQuotesRegex,
  frontmatterUrlRegex,
  frontmatterWikiLinkRegex,
} from "../markdown_parser/constants.ts";
import { processWikiLink, type WikiLinkMatch } from "./wiki_link_processor.ts";
import YAML from "js-yaml";

// ── Value renderer helpers ────────────────────────────────────────────────────

function renderFmValue(value: any): DocumentFragment {
  const frag = document.createDocumentFragment();

  if (value === null || value === undefined) {
    const el = document.createElement("span");
    el.className = "sb-fm-null";
    el.textContent = "—";
    frag.appendChild(el);
    return frag;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const chip = document.createElement("span");
      chip.className = "sb-fm-chip";
      chip.textContent = String(item);
      frag.appendChild(chip);
    }
    return frag;
  }

  if (typeof value === "boolean") {
    const el = document.createElement("span");
    el.className = `sb-fm-bool sb-fm-bool-${value}`;
    el.textContent = value ? "true" : "false";
    frag.appendChild(el);
    return frag;
  }

  if (typeof value === "number") {
    const el = document.createElement("span");
    el.className = "sb-fm-number";
    el.textContent = String(value);
    frag.appendChild(el);
    return frag;
  }

  if (value instanceof Date) {
    const el = document.createElement("span");
    el.className = "sb-fm-date";
    // Format as YYYY-MM-DD to match the YAML input style
    el.textContent = value.toISOString().slice(0, 10);
    frag.appendChild(el);
    return frag;
  }

  if (typeof value === "object") {
    // Nested object: compact JSON display
    const el = document.createElement("span");
    el.className = "sb-fm-object";
    el.textContent = JSON.stringify(value);
    frag.appendChild(el);
    return frag;
  }

  // String / default
  const el = document.createElement("span");
  el.className = "sb-fm-string";
  el.textContent = String(value);
  frag.appendChild(el);
  return frag;
}

// ── Panel widget ──────────────────────────────────────────────────────────────

class FrontmatterPanelWidget extends WidgetType {
  constructor(
    readonly yamlText: string,
    readonly blockFrom: number,
    readonly client: Client,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "sb-frontmatter-panel";

    // Header row
    const header = document.createElement("div");
    header.className = "sb-fm-header";
    header.innerHTML =
      `<i class="ti ti-list"></i><span>Properties</span><i class="ti ti-pencil sb-fm-edit-icon"></i>`;
    panel.appendChild(header);

    // Parse YAML
    let parsed: Record<string, any> = {};
    try {
      const result = YAML.load(this.yamlText);
      if (result && typeof result === "object" && !Array.isArray(result)) {
        parsed = result as Record<string, any>;
      }
    } catch {
      const err = document.createElement("div");
      err.className = "sb-fm-error";
      err.textContent = "⚠ Invalid YAML in frontmatter";
      panel.appendChild(err);
      this._attachClick(panel);
      return panel;
    }

    const entries = Object.entries(parsed);
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sb-fm-empty";
      empty.textContent = "No properties";
      panel.appendChild(empty);
      this._attachClick(panel);
      return panel;
    }

    for (const [key, value] of entries) {
      const row = document.createElement("div");
      row.className = "sb-fm-row";

      const keyEl = document.createElement("span");
      keyEl.className = "sb-fm-key";
      keyEl.textContent = key;
      row.appendChild(keyEl);

      const valEl = document.createElement("span");
      valEl.className = "sb-fm-value";
      valEl.appendChild(renderFmValue(value));
      row.appendChild(valEl);

      panel.appendChild(row);
    }

    this._attachClick(panel);
    return panel;
  }

  private _attachClick(panel: HTMLElement) {
    panel.addEventListener("click", () => {
      // Move cursor to just inside the frontmatter (after "---\n")
      this.client.editorView.dispatch({
        selection: { anchor: this.blockFrom + 4 },
      });
      this.client.focus();
    });
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof FrontmatterPanelWidget &&
      other.yamlText === this.yamlText
    );
  }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export function frontmatterPlugin(client: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];
    const shortWikiLinks = client.config.get("shortWikiLinks", true);

    syntaxTree(state).iterate({
      enter(node) {
        // ── Rendered panel (cursor outside) ───────────────────────────────────
        if (node.name === "FrontMatter") {
          const { from, to } = node;
          if (isCursorInRange(state, [from, to])) return;

          // Extract YAML text from FrontMatterCode child
          let yamlText = "";
          node.node.cursor().iterate((child) => {
            if (child.name === "FrontMatterCode") {
              yamlText = state.sliceDoc(child.from, child.to);
            }
          });

          // Hide the raw YAML lines
          hideBlockSource(widgets, state, from, to, "start");

          // Inject the panel widget at the start of the block
          widgets.push(
            Decoration.widget({
              widget: new FrontmatterPanelWidget(yamlText, from, client),
              block: true,
            }).range(from),
          );

          return false; // don't descend — we've handled this node
        }

        // ── Link decoration (cursor is inside frontmatter) ────────────────────
        if (node.name === "FrontMatterCode") {
          const oFrom = node.from;
          const oTo = node.to;

          if (!isCursorInRange(state, [oFrom, oTo])) {
            // Panel is showing — skip link decoration
            return;
          }

          const otext = state.sliceDoc(oFrom, oTo);

          let oMatch: RegExpExecArray | null;
          while ((oMatch = frontmatterQuotesRegex.exec(otext)) !== null) {
            const from = oFrom + (oMatch.index ?? 0);
            const to = from + oMatch[0].length;
            const text = state.sliceDoc(from, to);

            // External links
            frontmatterUrlRegex.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = frontmatterUrlRegex.exec(text)) !== null) {
              const mFrom = from + (match.index ?? 0);
              const mTo = mFrom + match[0].length;
              const url = match[1];
              widgets.push(
                Decoration.replace({
                  widget: new LinkWidget({
                    text: url,
                    title: `Open ${url}`,
                    href: url,
                    cssClass: "sb-external-link",
                    from: mFrom,
                    callback: (e) => {
                      if (e.altKey) {
                        client.editorView.dispatch({
                          selection: { anchor: mFrom },
                        });
                        client.focus();
                        return;
                      }
                      try {
                        if (/^https?:\/\//i.test(url)) {
                          globalThis.open(url, "_blank");
                        } else {
                          globalThis.open(url, "_self");
                        }
                      } catch (err) {
                        console.error("Failed to open external link", err);
                      }
                    },
                  }),
                }).range(mFrom, mTo),
              );
            }

            // Wiki links
            frontmatterWikiLinkRegex.lastIndex = 0;
            let wMatch: RegExpExecArray | null;
            while ((wMatch = frontmatterWikiLinkRegex.exec(text)) !== null) {
              if (!wMatch?.groups) return;
              const mFrom = from + (wMatch.index ?? 0);
              const mTo = mFrom + wMatch[0].length;

              const wikiLinkMatch: WikiLinkMatch = {
                leadingTrivia: wMatch.groups.leadingTrivia,
                stringRef: wMatch.groups.stringRef,
                alias: wMatch.groups.alias,
                trailingTrivia: wMatch.groups.trailingTrivia,
              };

              const decorations = processWikiLink({
                from,
                to,
                match: wikiLinkMatch,
                matchFrom: mFrom,
                matchTo: mTo,
                client,
                shortWikiLinks,
                state,
                callback: (e, ref) => {
                  if (e.altKey) {
                    client.editorView.dispatch({
                      selection: {
                        anchor: mFrom + wikiLinkMatch.leadingTrivia.length,
                      },
                    });
                    client.focus();
                    return;
                  }
                  void client.navigate(ref, false, e.ctrlKey || e.metaKey);
                },
              });

              widgets.push(...decorations);
            }

            // Mailto links
            frontmatterMailtoRegex.lastIndex = 0;
            let mMatch: RegExpExecArray | null;
            while ((mMatch = frontmatterMailtoRegex.exec(text)) !== null) {
              const mFrom = from + (mMatch.index ?? 0);
              const mTo = mFrom + mMatch[0].length;
              const url = mMatch[1];
              const address = url.slice(7);
              widgets.push(
                Decoration.replace({
                  widget: new LinkWidget({
                    text: url,
                    title: `Mail ${address}`,
                    href: url,
                    cssClass: "sb-external-link",
                    from: mFrom,
                    callback: (e) => {
                      if (e.altKey) {
                        client.editorView.dispatch({
                          selection: { anchor: mFrom },
                        });
                        client.focus();
                        return;
                      }
                      try {
                        globalThis.open(url, "_self");
                      } catch (err) {
                        console.error("Failed to open external link", err);
                      }
                    },
                  }),
                }).range(mFrom, mTo),
              );
            }
          }
        }
      },
    });

    return Decoration.set(widgets, true);
  });
}
