import { describe, expect, it } from "vitest";
import { computeTableFormulas, TableCalculator } from "./table_calc.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";

// Helper: row 0 is the header (referenced as row 1)
function calc(grid: string[][]) {
  return new TableCalculator(grid).evaluate();
}

describe("TableCalculator", () => {
  it("evaluates simple cell references", () => {
    const r = calc([
      ["plums", "bananas", "fruits"],
      ["5", "12", "=a2+b2"],
    ]);
    expect(r[1][2]).toBe("17");
    expect(r[1][0]).toBe(null); // literal cells untouched
  });

  it("supports arithmetic, precedence, parens, unary minus", () => {
    const r = calc([
      ["x"],
      ["=2+3*4"],
      ["=(2+3)*4"],
      ["=-3+10"],
      ["=2^3^2"], // right-assoc: 2^(3^2) = 512
      ["=10%3"],
    ]);
    expect(r[1][0]).toBe("14");
    expect(r[2][0]).toBe("20");
    expect(r[3][0]).toBe("7");
    expect(r[4][0]).toBe("512");
    expect(r[5][0]).toBe("1");
  });

  it("evaluates ranges with sum/avg/min/max/count", () => {
    const grid = [
      ["a", "b", "f"],
      ["5", "12", "=sum(a2:b4)"],
      ["7", "5", "=avg(a2:a4)"],
      ["9", "7", "=min(a2:b4)+max(a2:b4)"],
      ["", "", "=count(a2:b4)"],
    ];
    const r = calc(grid);
    expect(r[1][2]).toBe("45");
    expect(r[2][2]).toBe("7");
    expect(r[3][2]).toBe("17");
    expect(r[4][2]).toBe("6");
  });

  it("clamps open-ended ranges to the table", () => {
    const r = calc([
      ["m", "income", "total"],
      ["jan", "1800", "=sum(b2:b99)"],
      ["feb", "1700", ""],
    ]);
    expect(r[1][2]).toBe("3500");
  });

  it("errors when a formula's range includes itself", () => {
    const r = calc([
      ["m", "income"],
      ["jan", "1800"],
      ["total", "=sum(b2:b99)"], // b3 is inside b2:b99
    ]);
    expect(r[2][1]).toBe("#LOOP!");
  });

  it("supports whole-column ranges, skipping non-numeric cells", () => {
    const r = calc([
      ["label", "total"],
      ["3", "=sum(a:a)"],
      ["not", ""],
      ["2", ""],
    ]);
    expect(r[1][1]).toBe("5");
  });

  it("resolves formula chains (dependencies)", () => {
    const r = calc([
      ["a", "b", "c"],
      ["2", "=a2*10", "=b2+1"],
    ]);
    expect(r[1][1]).toBe("20");
    expect(r[1][2]).toBe("21");
  });

  it("detects loops", () => {
    const r = calc([
      ["a", "b"],
      ["=b2", "=a2"],
    ]);
    expect(r[1][0]).toBe("#LOOP!");
    expect(r[1][1]).toBe("#LOOP!");
  });

  it("detects self-reference in ranges", () => {
    const r = calc([
      ["a"],
      ["1"],
      ["=sum(a2:a3)"], // includes itself
    ]);
    expect(r[2][0]).toBe("#LOOP!");
  });

  it("reports reference and value errors", () => {
    const r = calc([
      ["a", "b"],
      ["text", "=a2+1"], // a2 not numeric
      ["1", "=z99+1"], // out of bounds
      ["0", "=1/a4"], // division by zero
    ]);
    expect(r[1][1]).toBe("#VALUE!");
    expect(r[2][1]).toBe("#REF!");
    expect(r[3][1]).toBe("#DIV/0!");
  });

  it("treats empty referenced cells as 0", () => {
    const r = calc([
      ["a", "b"],
      ["", "=a2+5"],
    ]);
    expect(r[1][1]).toBe("5");
  });

  it("leaves non-formula '=' cells untouched", () => {
    const r = calc([
      ["a", "b"],
      ["1", "=interesting stuff"],
      ["2", "="],
    ]);
    expect(r[1][1]).toBe(null);
    expect(r[2][1]).toBe(null);
  });

  it("supports constants and math functions", () => {
    const r = calc([
      ["x"],
      ["=round(pi, 2)"],
      ["=sqrt(16)"],
      ["=pow(2, 10)"],
      ["=abs(-4)+floor(1.9)+ceil(0.1)"],
    ]);
    expect(r[1][0]).toBe("3.14");
    expect(r[2][0]).toBe("4");
    expect(r[3][0]).toBe("1024");
    expect(r[4][0]).toBe("6");
  });

  it("parses literals with markdown emphasis and thousands separators", () => {
    const r = calc([
      ["a", "b"],
      ["**1,234**", "=a2+1"],
    ]);
    expect(r[1][1]).toBe("1235");
  });

  it("formats floats without noise", () => {
    const r = calc([
      ["a"],
      ["=0.1+0.2"],
    ]);
    expect(r[1][0]).toBe("0.3");
  });

  it("does not shift references on rows with empty cells (tree-level)", () => {
    const tree = parseMarkdown("|h1|h2|h3|\n|-|-|-|\n|5||=a2+10|\n");
    computeTableFormulas(tree);
    expect(renderToText(tree)).toContain("15");
  });
});