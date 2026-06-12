import type { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import {
  decoratorStateField,
  hideBlockSource,
  isCursorInRange,
} from "./util.ts";

import { renderMarkdownToHtml } from "../markdown_renderer/markdown_render.ts";
import {
  type ParseTree,
  renderToText,
} from "@silverbulletmd/silverbullet/lib/tree";
import { lezerToParseTree } from "../markdown_parser/parse_tree.ts";
import type { Client } from "../client.ts";
import { expandMarkdown } from "../markdown_renderer/inline.ts";
import {
  attachWidgetEventHandlers,
  buildTranslateUrls,
} from "./widget_util.ts";
import { computeTableFormulas } from "./table_calc.ts";

// Count a table's columns from its header row (falling back to the first body
// row), used when appending a new empty row.
function countTableColumns(t: ParseTree): number {
  const children = t.children ?? [];
  const row = children.find((c) => c.type === "TableHeader") ??
    children.find((c) => c.type === "TableRow");
  if (!row) return 0;
  return (row.children ?? []).filter((c) => c.type === "TableCell").length;
}

class TableViewWidget extends WidgetType {
  tableBodyText: string;

  constructor(
    readonly client: Client,
    readonly t: ParseTree,
  ) {
    super();
    this.tableBodyText = renderToText(t);
  }

  override get estimatedHeight(): number {
    return this.client.widgetCache.getCachedWidgetHeight(
      `table:${this.tableBodyText}`,
    );
  }

  toDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.classList.add("sb-table-widget");
    dom.addEventListener("click", (e) => {
      // Pulling data-pos to put the cursor in the right place, falling back
      // to the start of the table.
      const dataAttributes = (e.target as any).dataset;
      const fallbackPos = this.client.editorView.posAtDOM(dom, 0);
      this.client.editorView.dispatch({
        selection: {
          anchor: dataAttributes.pos ? +dataAttributes.pos : fallbackPos,
        },
      });
    });

    void expandMarkdown(
      this.client.space,
      this.client.currentName(),
      this.t,
      this.client.clientSystem.spaceLuaEnv,
      {
        syntaxExtensions: this.client.config.get("syntaxExtensions", {}),
      },
    ).then((t) => {
      // CalcCraft-style spreadsheet formulas: compute `=...` cells for the
      // rendered view (the markdown source keeps the formulas).
      try {
        computeTableFormulas(t);
      } catch (e) {
        console.warn("Table formula evaluation failed", e);
      }
      dom.innerHTML = renderMarkdownToHtml(t, {
        // Annotate every element with its position so we can use it to put
        // the cursor there when the user clicks on the table.
        annotationPositions: true,
        shortWikiLinks: this.client.config.get("shortWikiLinks", true),
        translateUrls: buildTranslateUrls(this.client),
      });
      setTimeout(() => {
        // Give it a tick to render
        attachWidgetEventHandlers(dom, this.client, this.tableBodyText);

        // "+ Add row" affordance: appends an empty row to the table source and
        // drops the cursor into its first cell, ready to type.
        const addRowBtn = document.createElement("button");
        addRowBtn.className = "sb-table-add-row";
        addRowBtn.textContent = "+ Add row";
        addRowBtn.title = "Add a row to this table";
        Object.assign(addRowBtn.style, {
          display: "block",
          marginTop: "3px",
          font: "inherit",
          fontSize: "0.8em",
          padding: "2px 8px",
          cursor: "pointer",
          borderRadius: "4px",
          border: "1px solid var(--color-border-tertiary, #ddd)",
          background: "var(--color-background-secondary, #f6f6f6)",
          color: "var(--color-text-secondary, #555)",
        });
        addRowBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const cols = countTableColumns(this.t);
          if (cols <= 0) return;
          const tableEnd = this.t.to;
          const newRow = "\n|" + "  |".repeat(cols);
          try {
            this.client.editorView.dispatch({
              changes: { from: tableEnd, to: tableEnd, insert: newRow },
              selection: { anchor: tableEnd + 3 },
            });
            this.client.focus?.();
          } catch (err) {
            console.error("Add row failed", err);
          }
        });
        dom.appendChild(addRowBtn);

        this.client.widgetCache.setCachedWidgetMeta(
          `table:${this.tableBodyText}`,
          { height: dom.clientHeight, block: true },
        );
      });
    });
    return dom;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof TableViewWidget &&
      other.tableBodyText === this.tableBodyText
    );
  }
}

export function tablePlugin(editor: Client) {
  return decoratorStateField((state: EditorState) => {
    const widgets: any[] = [];
    syntaxTree(state).iterate({
      enter: (node) => {
        const { from, to, name } = node;
        if (name !== "Table") return;
        if (isCursorInRange(state, [from, to])) return;

        hideBlockSource(widgets, state, from, to, "start");

        const text = state.sliceDoc(0, to);
        widgets.push(
          Decoration.widget({
            widget: new TableViewWidget(
              editor,
              lezerToParseTree(text, node.node),
            ),
          }).range(from),
        );
      },
    });
    return Decoration.set(widgets, true);
  });
}
