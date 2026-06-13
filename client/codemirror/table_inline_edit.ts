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

// --- Structural operations (pure, on TableModel) -----------------------------

function cloneModel(m: TableModel): TableModel {
  return {
    header: [...m.header],
    delimiter: m.delimiter,
    rows: m.rows.map((r) => [...r]),
    cols: m.cols,
  };
}

const clamp = (n: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, n));

/** Per-column alignment segments of a delimiter line, normalized and padded to `cols`. */
function delimSegments(delimiter: string, cols: number): string[] {
  const parts = delimiter
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => {
      const left = s.startsWith(":");
      const right = s.endsWith(":");
      return `${left ? ":" : ""}---${right ? ":" : ""}`;
    });
  while (parts.length < cols) parts.push("---");
  if (parts.length > cols) parts.length = cols;
  return parts;
}

function buildDelimiter(segments: string[]): string {
  return "| " + segments.join(" | ") + " |";
}

/** Insert an empty body row. `bodyIndex` is clamped into range. */
export function insertRow(m: TableModel, bodyIndex: number): TableModel {
  const n = cloneModel(m);
  const i = clamp(bodyIndex, 0, n.rows.length);
  n.rows.splice(i, 0, new Array(n.cols).fill(""));
  return n;
}

/** Delete a body row (no-op if out of range). */
export function deleteRow(m: TableModel, bodyIndex: number): TableModel {
  const n = cloneModel(m);
  if (bodyIndex >= 0 && bodyIndex < n.rows.length) n.rows.splice(bodyIndex, 1);
  return n;
}

/** Move a body row by `dir` (-1 up, +1 down); no-op if either end is out of range. */
export function moveRow(m: TableModel, bodyIndex: number, dir: number): TableModel {
  const n = cloneModel(m);
  const j = bodyIndex + dir;
  if (bodyIndex < 0 || bodyIndex >= n.rows.length || j < 0 || j >= n.rows.length) {
    return n;
  }
  [n.rows[bodyIndex], n.rows[j]] = [n.rows[j], n.rows[bodyIndex]];
  return n;
}

/** Insert an empty column at `colIndex` (clamped). Header, every row and the delimiter grow. */
export function insertColumn(m: TableModel, colIndex: number): TableModel {
  const n = cloneModel(m);
  const i = clamp(colIndex, 0, n.cols);
  n.header.splice(i, 0, "");
  n.rows.forEach((r) => r.splice(i, 0, ""));
  const segs = delimSegments(n.delimiter, n.cols);
  segs.splice(i, 0, "---");
  n.cols += 1;
  n.delimiter = buildDelimiter(segs);
  return n;
}

/** Delete the column at `colIndex` (no-op if out of range or it's the last column). */
export function deleteColumn(m: TableModel, colIndex: number): TableModel {
  const n = cloneModel(m);
  if (colIndex < 0 || colIndex >= n.cols || n.cols <= 1) return n;
  n.header.splice(colIndex, 1);
  n.rows.forEach((r) => r.splice(colIndex, 1));
  const segs = delimSegments(n.delimiter, n.cols);
  segs.splice(colIndex, 1);
  n.cols -= 1;
  n.delimiter = buildDelimiter(segs);
  return n;
}

/** Move a column by `dir` (-1 left, +1 right); no-op if either end is out of range. */
export function moveColumn(m: TableModel, colIndex: number, dir: number): TableModel {
  const n = cloneModel(m);
  const j = colIndex + dir;
  if (colIndex < 0 || colIndex >= n.cols || j < 0 || j >= n.cols) return n;
  const swap = (a: string[]) => {
    [a[colIndex], a[j]] = [a[j], a[colIndex]];
  };
  swap(n.header);
  n.rows.forEach(swap);
  const segs = delimSegments(n.delimiter, n.cols);
  [segs[colIndex], segs[j]] = [segs[j], segs[colIndex]];
  n.delimiter = buildDelimiter(segs);
  return n;
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

  // The model as it currently stands, including any in-progress cell edits.
  const currentModel = (): TableModel => ({
    header: gridVals[0].slice(),
    delimiter: model.delimiter,
    rows: gridVals.slice(1).map((r) => r.slice()),
    cols: model.cols,
  });

  // Apply a structural operation and write the whole table back in one
  // transaction. This re-renders the widget, so editing ends afterwards.
  const applyOp = (fn: (m: TableModel) => TableModel): void => {
    const next = fn(currentModel());
    committed = true; // stop the focusout handler from re-committing stale state
    try {
      client.editorView.dispatch({
        changes: { from: tableFrom, to: tableTo, insert: serializeTable(next) },
      });
    } catch (e) {
      console.error("Table structural op failed", e);
    }
  };

  // Build the row/column toolbar shown above the cell being edited. Buttons use
  // mousedown+preventDefault so the cell input keeps focus (no premature blur).
  const buildToolbar = (r: number, c: number): HTMLElement => {
    const bar = document.createElement("div");
    bar.className = "sb-table-toolbar";
    bar.contentEditable = "false";
    Object.assign(bar.style, {
      position: "absolute",
      left: "0",
      // Above the cell normally; below it for the header row (avoids clipping).
      ...(r === 0 ? { top: "100%" } : { bottom: "100%" }),
      zIndex: "10",
      display: "flex",
      gap: "6px",
      alignItems: "center",
      whiteSpace: "nowrap",
      padding: "2px 4px",
      marginBottom: "2px",
      borderRadius: "5px",
      border: "1px solid var(--color-border-tertiary, #ddd)",
      background: "var(--root-background-color, #fff)",
      boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
      fontSize: "0.75em",
      fontWeight: "normal",
    });

    const mkBtn = (label: string, title: string, op: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "sb-table-tb-btn";
      b.textContent = label;
      b.title = title;
      Object.assign(b.style, {
        font: "inherit",
        lineHeight: "1.4",
        minWidth: "1.6em",
        padding: "1px 5px",
        cursor: "pointer",
        borderRadius: "4px",
        border: "1px solid var(--color-border-tertiary, #ddd)",
        background: "var(--color-background-secondary, #f6f6f6)",
        color: "var(--color-text-secondary, #444)",
      });
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        op();
      });
      return b;
    };

    const group = (label: string, btns: HTMLElement[]) => {
      const g = document.createElement("span");
      g.className = "sb-table-tb-group";
      Object.assign(g.style, { display: "flex", gap: "2px", alignItems: "center" });
      const l = document.createElement("span");
      l.className = "sb-table-tb-label";
      l.textContent = label;
      Object.assign(l.style, {
        color: "var(--color-text-secondary, #888)",
        marginRight: "2px",
      });
      g.appendChild(l);
      btns.forEach((b) => g.appendChild(b));
      return g;
    };

    bar.appendChild(
      group("Row", [
        mkBtn("+↑", "Insert row above", () => applyOp((m) => insertRow(m, Math.max(r - 1, 0)))),
        mkBtn("+↓", "Insert row below", () => applyOp((m) => insertRow(m, r))),
        mkBtn("↑", "Move row up", () => applyOp((m) => moveRow(m, r - 1, -1))),
        mkBtn("↓", "Move row down", () => applyOp((m) => moveRow(m, r - 1, 1))),
        mkBtn("✕", "Delete row", () => applyOp((m) => deleteRow(m, r - 1))),
      ]),
    );
    bar.appendChild(
      group("Col", [
        mkBtn("+←", "Insert column left", () => applyOp((m) => insertColumn(m, c))),
        mkBtn("+→", "Insert column right", () => applyOp((m) => insertColumn(m, c + 1))),
        mkBtn("←", "Move column left", () => applyOp((m) => moveColumn(m, c, -1))),
        mkBtn("→", "Move column right", () => applyOp((m) => moveColumn(m, c, 1))),
        mkBtn("✕", "Delete column", () => applyOp((m) => deleteColumn(m, c))),
      ]),
    );
    return bar;
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
    el.style.position = "relative";
    el.appendChild(input);
    // Row/column controls, anchored above this cell.
    el.appendChild(buildToolbar(r, c));
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
