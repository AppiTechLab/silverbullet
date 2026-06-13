import { describe, expect, it } from "vitest";
import {
  buildTableRow,
  deleteColumn,
  deleteRow,
  escapeCell,
  insertColumn,
  insertRow,
  isDelimiterLine,
  moveColumn,
  moveRow,
  parseTable,
  serializeTable,
  splitTableRow,
} from "./table_inline_edit.ts";

describe("isDelimiterLine", () => {
  it("recognizes alignment rows", () => {
    expect(isDelimiterLine("| --- | --- |")).toBe(true);
    expect(isDelimiterLine("|:---|---:|:--:|")).toBe(true);
    expect(isDelimiterLine("---|---")).toBe(true);
  });
  it("rejects content rows", () => {
    expect(isDelimiterLine("| a | b |")).toBe(false);
    expect(isDelimiterLine("| 1 | 2 |")).toBe(false);
    expect(isDelimiterLine("|   |   |")).toBe(false); // no dashes
  });
});

describe("splitTableRow", () => {
  it("splits and trims cells, stripping outer pipes", () => {
    expect(splitTableRow("| a | b | c |")).toEqual(["a", "b", "c"]);
  });
  it("handles missing outer pipes", () => {
    expect(splitTableRow("a | b")).toEqual(["a", "b"]);
  });
  it("keeps empty cells between pipes", () => {
    expect(splitTableRow("| a |  | c |")).toEqual(["a", "", "c"]);
  });
  it("unescapes escaped pipes into literal pipes", () => {
    expect(splitTableRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
  });
});

describe("escapeCell", () => {
  it("escapes pipes and flattens newlines", () => {
    expect(escapeCell("a | b")).toBe("a \\| b");
    expect(escapeCell("line1\nline2")).toBe("line1 line2");
  });
});

describe("buildTableRow", () => {
  it("builds a padded pipe row", () => {
    expect(buildTableRow(["a", "b"])).toBe("| a | b |");
  });
});

describe("parseTable", () => {
  it("parses header, delimiter and body", () => {
    const src = "| name | qty |\n| --- | --- |\n| apple | 3 |\n| pear | 5 |";
    const m = parseTable(src);
    expect(m).not.toBeNull();
    expect(m!.header).toEqual(["name", "qty"]);
    expect(m!.delimiter).toBe("| --- | --- |");
    expect(m!.rows).toEqual([["apple", "3"], ["pear", "5"]]);
    expect(m!.cols).toBe(2);
  });

  it("pads ragged rows to the header column count", () => {
    const src = "| a | b | c |\n|---|---|---|\n| 1 | 2 |";
    const m = parseTable(src)!;
    expect(m.rows).toEqual([["1", "2", ""]]);
  });

  it("returns null when there is no delimiter row", () => {
    expect(parseTable("just some text")).toBeNull();
    expect(parseTable("| a | b |")).toBeNull();
  });
});

describe("round-trip", () => {
  it("preserves alignment and = formulas", () => {
    const src = "| item | price |\n|:---|---:|\n| a | 10 |\n| b | =sum(b2:b2) |";
    const m = parseTable(src)!;
    const out = serializeTable(m);
    // Formula stays intact, alignment delimiter preserved verbatim.
    expect(out).toContain("=sum(b2:b2)");
    expect(out).toContain("|:---|---:|");
    // Re-parsing the output is stable.
    expect(parseTable(out)).toEqual(parseTable(src));
  });

  it("survives editing a single cell", () => {
    const src = "| name | qty |\n| --- | --- |\n| apple | 3 |";
    const m = parseTable(src)!;
    m.rows[0][1] = "42";
    const out = serializeTable(m);
    expect(out).toBe("| name | qty |\n| --- | --- |\n| apple | 42 |");
  });
});

describe("row operations", () => {
  const base = () =>
    parseTable("| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |")!;

  it("insertRow adds an empty body row at the index", () => {
    const m = insertRow(base(), 1);
    expect(m.rows).toEqual([["1", "2"], ["", ""], ["3", "4"]]);
  });
  it("insertRow clamps out-of-range indices", () => {
    expect(insertRow(base(), 99).rows.length).toBe(3);
    expect(insertRow(base(), -5).rows[0]).toEqual(["", ""]);
  });
  it("deleteRow removes a body row", () => {
    expect(deleteRow(base(), 0).rows).toEqual([["3", "4"]]);
  });
  it("deleteRow is a no-op out of range", () => {
    expect(deleteRow(base(), 9).rows.length).toBe(2);
  });
  it("moveRow swaps rows", () => {
    expect(moveRow(base(), 0, 1).rows).toEqual([["3", "4"], ["1", "2"]]);
    expect(moveRow(base(), 0, -1).rows).toEqual([["1", "2"], ["3", "4"]]); // no-op at top
  });
  it("does not mutate the input model", () => {
    const m = base();
    insertRow(m, 0);
    expect(m.rows.length).toBe(2);
  });
});

describe("column operations", () => {
  const base = () =>
    parseTable("| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 | 4 |")!;

  it("insertColumn grows header, rows, delimiter and cols", () => {
    const m = insertColumn(base(), 1);
    expect(m.cols).toBe(3);
    expect(m.header).toEqual(["a", "", "b"]);
    expect(m.rows).toEqual([["1", "", "2"], ["3", "", "4"]]);
    expect(m.delimiter).toBe("| :--- | --- | ---: |");
  });
  it("deleteColumn shrinks everything and preserves alignment", () => {
    const m = deleteColumn(base(), 0);
    expect(m.cols).toBe(1);
    expect(m.header).toEqual(["b"]);
    expect(m.rows).toEqual([["2"], ["4"]]);
    expect(m.delimiter).toBe("| ---: |");
  });
  it("deleteColumn refuses to remove the last column", () => {
    const one = parseTable("| a |\n| --- |\n| 1 |")!;
    expect(deleteColumn(one, 0).cols).toBe(1);
  });
  it("moveColumn swaps header, rows and alignment", () => {
    const m = moveColumn(base(), 0, 1);
    expect(m.header).toEqual(["b", "a"]);
    expect(m.rows).toEqual([["2", "1"], ["4", "3"]]);
    expect(m.delimiter).toBe("| ---: | :--- |");
  });
  it("round-trips through serializeTable", () => {
    const out = serializeTable(insertColumn(base(), 2));
    expect(parseTable(out)!.cols).toBe(3);
  });
});
