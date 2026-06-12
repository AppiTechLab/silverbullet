/**
 * CalcCraft-style spreadsheet formulas for markdown tables.
 *
 * Cells starting with `=` are treated as formulas and replaced by their
 * computed value in the rendered table widget (the raw formula stays in the
 * markdown source and is visible while editing).
 *
 * Supported:
 * - Cell references: `a1`, `b12` (column letter a-z, 1-based row; the header
 *   row is row 1, the first body row is row 2 — same as CalcCraft)
 * - Ranges as function arguments: `sum(a2:b5)`, `sum(a:a)` (whole column),
 *   open-ended rows like `sum(b2:b99)` are clamped to the table
 * - Arithmetic: `+ - * / % ^`, parentheses, unary minus
 * - Functions: sum, avg/mean/average, min, max, count, counta, round, abs,
 *   sqrt, floor, ceil, pow, product/prod
 * - Constants: pi, e
 *
 * Errors are shown spreadsheet-style: #LOOP!, #REF!, #VALUE!, #DIV/0!.
 * Cells that start with `=` but don't parse as a formula are left untouched.
 */

import type { ParseTree } from "@silverbulletmd/silverbullet/lib/tree";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";

// --- Errors -----------------------------------------------------------------

/** Evaluation error rendered into the cell (e.g. #REF!, #LOOP!). */
class CellError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Parse/name error: the cell is probably not a real formula; leave it as-is. */
class SoftError extends Error {}

// --- Tokenizer ---------------------------------------------------------------

type Token =
  | { type: "num"; value: number }
  | { type: "ident"; value: string }
  | { type: "op"; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(input[i + 1] ?? ""))) {
      let j = i;
      while (j < input.length && /[0-9.]/.test(input[j])) j++;
      const text = input.slice(i, j);
      const value = Number(text);
      if (isNaN(value)) throw new SoftError(`bad number ${text}`);
      tokens.push({ type: "num", value });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < input.length && /[a-zA-Z0-9_]/.test(input[j])) j++;
      tokens.push({ type: "ident", value: input.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/%^(),:".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
      continue;
    }
    throw new SoftError(`unexpected character ${ch}`);
  }
  return tokens;
}

// --- Parser / evaluator -------------------------------------------------------

/** A value is a number, or a list of numbers (a range, only valid in functions). */
type Value = number | number[];

interface CellRef {
  col: number; // 0-based
  row: number; // 0-based (row 0 = header = "1")
}

const CELL_REF_RE = /^([a-z])([0-9]+)$/i;
const COL_ONLY_RE = /^[a-z]$/i;

type Functions = Record<string, (args: Value[]) => number>;

function flatten(args: Value[]): number[] {
  const out: number[] = [];
  for (const a of args) {
    if (Array.isArray(a)) out.push(...a);
    else out.push(a);
  }
  return out;
}

const FUNCTIONS: Functions = {
  sum: (args) => flatten(args).reduce((a, b) => a + b, 0),
  product: (args) => flatten(args).reduce((a, b) => a * b, 1),
  prod: (args) => flatten(args).reduce((a, b) => a * b, 1),
  avg: (args) => {
    const v = flatten(args);
    if (v.length === 0) throw new CellError("#DIV/0!");
    return v.reduce((a, b) => a + b, 0) / v.length;
  },
  min: (args) => {
    const v = flatten(args);
    if (v.length === 0) throw new CellError("#VALUE!");
    return Math.min(...v);
  },
  max: (args) => {
    const v = flatten(args);
    if (v.length === 0) throw new CellError("#VALUE!");
    return Math.max(...v);
  },
  count: (args) => flatten(args).length,
  round: (args) => {
    const [x, n] = args;
    if (typeof x !== "number") throw new CellError("#VALUE!");
    const digits = typeof n === "number" ? n : 0;
    const f = Math.pow(10, digits);
    return Math.round(x * f) / f;
  },
  abs: (args) => Math.abs(num(args[0])),
  sqrt: (args) => Math.sqrt(num(args[0])),
  floor: (args) => Math.floor(num(args[0])),
  ceil: (args) => Math.ceil(num(args[0])),
  pow: (args) => Math.pow(num(args[0]), num(args[1])),
};
// Aliases
FUNCTIONS.mean = FUNCTIONS.avg;
FUNCTIONS.average = FUNCTIONS.avg;
FUNCTIONS.counta = FUNCTIONS.count;

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

function num(v: Value | undefined): number {
  if (typeof v !== "number") throw new CellError("#VALUE!");
  return v;
}

/**
 * Evaluates formulas in a grid of raw cell strings.
 * grid[0] is the header row (referenced as row 1).
 */
export class TableCalculator {
  /** Cache: computed numeric value per "col,row" key. */
  private cache = new Map<string, number>();
  /** Cells currently being evaluated (loop detection). */
  private computing = new Set<string>();

  constructor(private grid: string[][]) {}

  /**
   * Returns display values: result string for formula cells,
   * null for everything else (including formula cells we leave untouched).
   */
  evaluate(): (string | null)[][] {
    return this.grid.map((row, r) =>
      row.map((cell, c) => {
        if (!isFormula(cell)) return null;
        try {
          return formatNumber(this.evalCell(c, r));
        } catch (e) {
          if (e instanceof CellError) return e.code;
          return null; // SoftError: not really a formula, leave as-is
        }
      })
    );
  }

  /** Numeric value of a cell (formula or literal). */
  private evalCell(col: number, row: number): number {
    const key = `${col},${row}`;
    if (this.cache.has(key)) return this.cache.get(key)!;
    if (this.computing.has(key)) throw new CellError("#LOOP!");

    const raw = this.grid[row]?.[col];
    if (raw === undefined) throw new CellError("#REF!");

    let value: number;
    if (isFormula(raw)) {
      this.computing.add(key);
      try {
        value = num(this.evalFormula(raw.slice(1), { col, row }));
      } finally {
        this.computing.delete(key);
      }
    } else {
      value = literalNumber(raw);
    }
    this.cache.set(key, value);
    return value;
  }

  /** Numeric value of a literal/formula cell for use inside ranges; null if not numeric. */
  private rangeCellValue(col: number, row: number): number | null {
    const raw = this.grid[row]?.[col];
    if (raw === undefined) return null;
    if (isFormula(raw)) {
      // Formula cells participate in ranges (loops still throw).
      try {
        return this.evalCell(col, row);
      } catch (e) {
        if (e instanceof CellError && e.code === "#LOOP!") throw e;
        return null;
      }
    }
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(stripFormatting(trimmed));
    return isNaN(n) ? null : n;
  }

  private evalFormula(src: string, self: CellRef): Value {
    const tokens = tokenize(src);
    if (tokens.length === 0) throw new SoftError("empty formula");
    let pos = 0;

    const peek = () => tokens[pos];
    const eat = (opValue?: string): Token => {
      const t = tokens[pos];
      if (!t) throw new SoftError("unexpected end of formula");
      if (opValue !== undefined && (t.type !== "op" || t.value !== opValue)) {
        throw new SoftError(`expected ${opValue}`);
      }
      pos++;
      return t;
    };
    const isOp = (v: string) => {
      const t = peek();
      return t?.type === "op" && t.value === v;
    };

    const parseExpr = (): Value => {
      let left = parseTerm();
      while (isOp("+") || isOp("-")) {
        const op = (eat() as { value: string }).value;
        const right = parseTerm();
        left = op === "+" ? num(left) + num(right) : num(left) - num(right);
      }
      return left;
    };

    const parseTerm = (): Value => {
      let left = parseUnary();
      while (isOp("*") || isOp("/") || isOp("%")) {
        const op = (eat() as { value: string }).value;
        const right = parseUnary();
        const l = num(left);
        const r = num(right);
        if ((op === "/" || op === "%") && r === 0) {
          throw new CellError("#DIV/0!");
        }
        left = op === "*" ? l * r : op === "/" ? l / r : l % r;
      }
      return left;
    };

    const parseUnary = (): Value => {
      if (isOp("-")) {
        eat();
        return -num(parseUnary());
      }
      if (isOp("+")) {
        eat();
        return num(parseUnary());
      }
      return parsePower();
    };

    const parsePower = (): Value => {
      const base = parseAtom();
      if (isOp("^")) {
        eat();
        return Math.pow(num(base), num(parseUnary()));
      }
      return base;
    };

    const parseAtom = (): Value => {
      const t = peek();
      if (!t) throw new SoftError("unexpected end of formula");

      if (t.type === "num") {
        eat();
        return t.value;
      }

      if (t.type === "op" && t.value === "(") {
        eat();
        const v = parseExpr();
        eat(")");
        return v;
      }

      if (t.type === "ident") {
        const name = t.value;
        eat();

        // Function call
        if (isOp("(")) {
          const fn = FUNCTIONS[name.toLowerCase()];
          if (!fn) throw new SoftError(`unknown function ${name}`);
          eat("(");
          const args: Value[] = [];
          if (!isOp(")")) {
            args.push(parseExpr());
            while (isOp(",")) {
              eat();
              args.push(parseExpr());
            }
          }
          eat(")");
          return fn(args);
        }

        // Range or single cell reference
        const refMatch = CELL_REF_RE.exec(name);
        const colOnly = COL_ONLY_RE.test(name) && !(name.toLowerCase() in CONSTANTS);
        if (refMatch || colOnly) {
          if (isOp(":")) {
            eat();
            const endTok = eat();
            if (endTok.type !== "ident") throw new SoftError("bad range");
            return this.expandRange(name, endTok.value);
          }
          if (refMatch) {
            const ref = parseRef(refMatch);
            if (ref.col === self.col && ref.row === self.row) {
              throw new CellError("#LOOP!");
            }
            return this.evalCell(ref.col, ref.row);
          }
          throw new SoftError("bare column reference");
        }

        const constant = CONSTANTS[name.toLowerCase()];
        if (constant !== undefined) return constant;
        throw new SoftError(`unknown name ${name}`);
      }

      throw new SoftError("unexpected token");
    };

    const result = parseExpr();
    if (pos < tokens.length) throw new SoftError("trailing tokens");
    return result;
  }

  /** Expands `a2:b5`, `a:a` (whole column), clamping rows to the table. */
  private expandRange(startName: string, endName: string): number[] {
    const start = parseRangeEndpoint(startName, 0);
    const end = parseRangeEndpoint(endName, this.grid.length - 1);
    const colFrom = Math.min(start.col, end.col);
    const colTo = Math.max(start.col, end.col);
    const rowFrom = Math.max(Math.min(start.row, end.row), 0);
    const rowTo = Math.min(Math.max(start.row, end.row), this.grid.length - 1);
    const values: number[] = [];
    for (let r = rowFrom; r <= rowTo; r++) {
      for (let c = colFrom; c <= colTo; c++) {
        const v = this.rangeCellValue(c, r);
        if (v !== null) values.push(v);
      }
    }
    return values;
  }
}

function isFormula(cell: string): boolean {
  const t = cell.trim();
  return t.length > 1 && t.startsWith("=");
}

function parseRef(m: RegExpExecArray): CellRef {
  return {
    col: m[1].toLowerCase().charCodeAt(0) - 97,
    row: parseInt(m[2], 10) - 1,
  };
}

/** Parses a range endpoint: `b5`, or bare column `b` which uses defaultRow. */
function parseRangeEndpoint(name: string, defaultRow: number): CellRef {
  const m = CELL_REF_RE.exec(name);
  if (m) return parseRef(m);
  if (COL_ONLY_RE.test(name)) {
    return { col: name.toLowerCase().charCodeAt(0) - 97, row: defaultRow };
  }
  throw new SoftError(`bad range endpoint ${name}`);
}

/** Strips markdown emphasis and thousands separators before number parsing. */
function stripFormatting(s: string): string {
  return s.replace(/[*_`~]/g, "").replace(/(\d),(?=\d{3}\b)/g, "$1").trim();
}

function literalNumber(raw: string): number {
  const t = raw.trim();
  if (t === "") return 0;
  const n = Number(stripFormatting(t));
  if (isNaN(n)) throw new CellError("#VALUE!");
  return n;
}

function formatNumber(n: number): string {
  if (!isFinite(n)) throw new CellError("#DIV/0!");
  if (Number.isInteger(n)) return String(n);
  // Round to 10 significant decimals to hide float noise, trim trailing zeros
  return String(Number(n.toFixed(10)));
}

// --- ParseTree integration ----------------------------------------------------

/**
 * Computes formulas in a Table parse tree, replacing the contents of formula
 * cells with their computed values. Mutates the tree. No-op for tables
 * without formulas.
 */
export function computeTableFormulas(tree: ParseTree): void {
  if (tree.type !== "Table") {
    // Allow being called on a wrapper; find the table
    const table = tree.children?.find((c) => c.type === "Table");
    if (!table) return;
    tree = table;
  }

  // Collect rows (header first, like CalcCraft: header = row 1)
  const rowNodes = (tree.children ?? []).filter(
    (c) => c.type === "TableHeader" || c.type === "TableRow",
  );
  const cellNodes: ParseTree[][] = rowNodes.map((row) =>
    (row.children ?? []).filter((c) => c.type === "TableCell")
  );
  const grid = cellNodes.map((row) =>
    row.map((cell) => renderToText(cell).trim())
  );

  if (!grid.some((row) => row.some(isFormula))) {
    return;
  }

  const results = new TableCalculator(grid).evaluate();

  for (let r = 0; r < cellNodes.length; r++) {
    for (let c = 0; c < cellNodes[r].length; c++) {
      const result = results[r]?.[c];
      if (result === null || result === undefined) continue;
      const cell = cellNodes[r][c];
      cell.children = [{ text: ` ${result} `, from: cell.from }];
    }
  }
}
