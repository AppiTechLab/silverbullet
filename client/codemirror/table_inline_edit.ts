/**
 * Inline cell editing for the rendered table widget.
 *
 * Goal: let the user click a cell in the *rendered* table and edit it in place
 * (Tab / Shift-Tab / Enter to move between cells), instead of being dropped into
 * the raw pipe-markdown source.
 *
 * Design notes:
 * - The table source is the single source of truth. We parse it into a simple
 *   `{ header, delimiter, rows }` model (see `parseTable`), let the user mutate
 *   a per-cell grid in the DOM, and write the whole table back in ONE editor
 *   transaction only when focus leaves the table. Doing it in one transaction
 *   avoids a widget re-render on every keystroke (which would destroy focus and
 *   break Tab navigation).
 * - `=` formulas are preserved: the editable text shown for a cell is its raw
 *   source (e.g. `=sum(b2:b5)`), never the computed value, so editing a computed
 *   cell edits the formula.
 * - The delimiter (alignment) row is preserved verbatim, so `:--:` style column
 *   alignment survives a round-trip.
 *
 * The pure helpers (`parseTable`, `serializeTable`, `splitTableRow`,
 * `buildTableRow`, `escapeCell`, `isDelimiterLine`) are exported for unit tests.
 */

import type { Client } from "../client.ts";

export type TableModel = {
  header: string[];
  /** The raw delimiter / alignment line, preserved verbatim. */
  delimiter: string;
  rows: string[][];
  cols: number;
};

/** A line that is only pipes, dashes, colons and whitespace (the alignment row). */
export function isDelimiterLine(line: string): boolean {
  return /^[\s|:-]+$/.test(line) && line.includes("-");
}

/**
 * Split a markdown table row into logical cell strings.
 * Strips the outer pipes, unescapes `\|` to a literal `|`, and trims each cell.
 */
export function splitTableRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\" && line[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  // Drop the empty fragments produced by a leading / trailing pipe.
  if (cells.length && cells[0].trim() === "") cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

/** Escape a logical cell value for safe embedding in a pipe table. */
export function escapeCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

/** Build a `| a | b | c |` row from logical cell values. */
export function buildTableRow(cells: string[]): string {
  return "| " + cells.map(escapeCell).join(" | ") + " |";
}

/** Parse a table's source text into an editable model, or null if it isn't a standard table. */
export function parseTable(src: string): TableModel | null {
  const lines = src.replace(/\r/g, "").split("\n");
  let di = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isDelimiterLine(lines[i])) {
      di = i;
      break;
    }
  }
  // We need at least one header line before the delimiter.
  if (di < 1) return null;
  const header = splitTableRow(lines[di - 1]);
  if (header.length === 0) return null;
  const delimiter = lines[di];
  const rows = lines
    .slice(di + 1)
    .filter((l) => l.trim() !== "")
    .map(splitTableRow);
  const cols = header.length;
  for (const r of rows) {
    while (r.length < cols) r.push("");
    if (r.length > cols) r.length = cols;
  }
  return { header, delimiter, rows, cols };
}

/** Serialize an editable model back to markdown table source. */
export function serializeTable(model: TableModel): string {
  return [
    buildTableRow(model.header),
    model.delimiter,
    ...model.rows.map(buildTableRow),
  ].join("\n");
}

// --- DOM wiring (browser only) ----------------------------------------------

/**
 * Attach inline editing to an already-rendered table widget.
 *
 * @param dom         the widget root element
 * @param client      the editor client (for dispatching the write-back)
 * @param tableFrom   source start offset of the whole table
 * @param tableTo     source end offset of the whole table
 * @param src         the table's source text
 */
export function attachInlineTableEditing(
  dom: HTMLElement,
  client: Client,
  tableFrom: number,
  tableTo: number,
  src: string,
): void {
  const model = parseTable(src);
  if (!model) return;
  const table = dom.querySelector("table");
  if (!table) return;

  // grid[0] is the header row, grid[1..] are body rows. Keep DOM elements and
  // values in parallel 2D arrays so we can map a clicked cell to the model.
  const gridVals: string[][] = [model.header, ...model.rows];
  const gridEls: (HTMLElement | undefined)[][] = [];

  const headerCells = Array.from(
    table.querySelectorAll<HTMLElement>(":scope > thead > tr > td, :scope > thead > tr > th"),
  );
  gridEls[0] = headerCells;
  // Body rows may be wrapped in a <tbody> (the browser / renderer inserts one)
  // or be direct children of <table>; handle both.
  const bodyRows = Array.from(
    table.querySelectorAll<HTMLElement>(":scope > tbody > tr, :scope > tr"),
  );
  bodyRows.forEach((tr, i) => {
    gridEls[i + 1] = Array.from(
      tr.querySelectorAll<HTMLElement>(":scope > td, :scope > th"),
    );
  });

  // Flattened, ordered list of editable cells for Tab navigation.
  const order: { r: number; c: number; el: HTMLElement }[] = [];
  // Saved rendered HTML so we can restore a cell's look on cancel.
  const originalHtml = new WeakMap<HTMLElement, string>();
  // The pristine values, for Escape (cancel) to revert to.
  const originalVals = gridVals.map((row) => row.slice());
  let dirty = false;
  let cancelled = false;
  let committed = false;
  // True while Escape is reverting cells, so the blur handler doesn't fight it.
  let reverting = false;

  const commit = (): void => {
    if (committed) return;
    committed = true;
    if (cancelled || !dirty) return;
    const next = serializeTable({
      header: gridVals[0],
      delimiter: model.delimiter,
      rows: gridVals.slice(1),
      cols: model.cols,
    });
    if (next === src) return;
    try {
      client.editorView.dispatch({
        changes: { from: tableFrom, to: tableTo, insert: next },
      });
    } catch (e) {
      console.error("Inline table edit write-back failed", e);
    }
  };

  // Leave editing entirely (blur the input), which triggers the focusout commit.
  const finish = (): void => {
    const input = dom.querySelector<HTMLInputElement>("input.sb-cell-input");
    input?.blur();
  };

  // Replace a cell's rendered content with a text <input> bound to gridVals.
  // We use a native form control (not contentEditable) on purpose: CodeMirror's
  // selection observer ignores selections inside <input>, so editing here does
  // NOT move the document cursor into the table and flip it to raw source.
  const edit = (r: number, c: number): void => {
    const el = gridEls[r]?.[c];
    if (!el) return;
    if (!originalHtml.has(el)) originalHtml.set(el, el.innerHTML);

    const input = document.createElement("input");
    input.type = "text";
    input.className = "sb-cell-input";
    input.spellcheck = false;
    input.value = gridVals[r][c];
    Object.assign(input.style, {
      width: "100%",
      boxSizing: "border-box",
      font: "inherit",
      color: "inherit",
      border: "none",
      outline: "none",
      padding: "0",
      margin: "0",
      background: "transparent",
      textAlign: "inherit",
    });

    el.textContent = "";
    el.appendChild(input);
    input.focus();
    input.select();

    const stop = (e: Event) => e.stopPropagation();
    input.addEventListener("mousedown", stop);
    input.addEventListener("click", stop);

    input.addEventListener("input", () => {
      gridVals[r][c] = input.value;
      dirty = true;
    });

    // When the cell loses focus (clicking/Tabbing to another cell, or away),
    // remove the input so its blue "editing" outline doesn't linger. If the
    // value is unchanged, restore the original rendered look; otherwise show
    // the new text (the whole table re-renders on commit anyway).
    input.addEventListener("blur", () => {
      if (reverting) return;
      const cell = input.parentElement;
      if (!cell) return;
      gridVals[r][c] = input.value;
      const html = originalHtml.get(el);
      if (input.value === originalVals[r][c] && html !== undefined) {
        cell.innerHTML = html;
      } else {
        cell.textContent = input.value;
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const idx = order.findIndex((o) => o.r === r && o.c === c);
        const target = order[idx + (e.shiftKey ? -1 : 1)];
        if (target) edit(target.r, target.c);
        else finish();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (gridEls[r + 1]?.[c]) edit(r + 1, c);
        else finish();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelled = true;
        reverting = true;
        // Revert values and restore every touched cell's rendered look.
        for (let rr = 0; rr < gridVals.length; rr++) {
          for (let cc = 0; cc < gridVals[rr].length; cc++) {
            gridVals[rr][cc] = originalVals[rr][cc];
          }
        }
        for (const o of order) {
          const html = originalHtml.get(o.el);
          if (html !== undefined) o.el.innerHTML = html;
        }
        finish();
        reverting = false;
      }
    });
  };

  for (let r = 0; r < gridVals.length; r++) {
    for (let c = 0; c < gridVals[r].length; c++) {
      const el = gridEls[r]?.[c];
      if (!el) continue;
      order.push({ r, c, el });
      el.dataset.sbCellR = String(r);
      el.dataset.sbCellC = String(c);
      el.classList.add("sb-table-cell-editable");

      // Click a cell to edit it. stopPropagation keeps the click from reaching
      // the widget's cursor-positioning handler (which would jump to raw source).
      el.addEventListener("mousedown", (e) => e.stopPropagation());
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Already editing this cell? Leave the input alone.
        if (el.querySelector("input.sb-cell-input")) return;
        edit(r, c);
      });
    }
  }

  if (order.length === 0) return;

  // Commit when focus leaves the table entirely. Tab/Enter move focus
  // programmatically (relatedTarget is unreliable across browsers), so defer
  // and re-check the active element.
  dom.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!dom.contains(document.activeElement)) commit();
    }, 0);
  });
}
