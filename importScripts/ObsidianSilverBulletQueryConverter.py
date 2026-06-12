#!/usr/bin/env python3
"""
Convert task queries between Obsidian (Tasks plugin) and SilverBullet.

  Obsidian  ```tasks ...```            <->   SilverBullet  ${query[[ ... ]]}

Usage:
  # Preview Obsidian -> SilverBullet for a vault (no files changed):
  python obsidian_silverbullet_queries.py --to silverbullet /path/to/vault

  # Apply in place (originals saved as *.bak):
  python obsidian_silverbullet_queries.py --to silverbullet /path/to/vault --in-place

  # The other direction:
  python obsidian_silverbullet_queries.py --to obsidian /path/to/space [--in-place]

Notes:
- Only the common Tasks-plugin instructions are translated. Anything not
  recognised is preserved verbatim inside an HTML comment so nothing is lost.
- See the caveats printed at the end of a run.
"""
import argparse
import pathlib
import re
import sys

PRIORITIES = {"highest", "high", "medium", "normal", "low", "lowest"}
DATE_KEYWORDS = {
    "today": "date.today()",
    "tomorrow": "date.tomorrow()",
    "yesterday": "date.yesterday()",
}
# Obsidian "due before tomorrow" == "due on or before today"; map keywords to SB.
FIELD_ALIASES = {"done": "completion"}


# ----------------------------- Obsidian -> SilverBullet -----------------------------

def _date_expr(token):
    token = token.strip()
    if token in DATE_KEYWORDS:
        return DATE_KEYWORDS[token]
    if re.match(r"\d{4}-\d{2}-\d{2}$", token):
        return f'"{token}"'
    return None


def obsidian_block_to_sb(instructions):
    """Return (sb_query_string, unconverted_lines)."""
    conds, order_by, limit, unconv = [], None, None, []
    for raw in instructions:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        low = line.lower()
        m = None
        if low == "not done":
            conds.append("not t.done")
        elif low == "done":
            conds.append("t.done")
        elif low in ("no due date", "has no due date"):
            conds.append("not t.due")
        elif low in ("has due date",):
            conds.append("t.due")
        elif (m := re.match(
                r"(due|scheduled|start|created|done|completion) (before|after|on) (.+)", low)):
            field = FIELD_ALIASES.get(m.group(1), m.group(1))
            de = _date_expr(m.group(3))
            if de is None:
                unconv.append(line)
                continue
            cmp = {"before": "<", "after": ">", "on": "=="}[m.group(2)]
            conds.append(f"t.{field} and tostring(t.{field}) {cmp} {de}")
        elif (m := re.match(r"priority is (?:above |below )?(\w+)", low)):
            p = m.group(1)
            if p in PRIORITIES:
                conds.append(f't.priority == "{p}"')
            else:
                unconv.append(line)
        elif (m := re.match(r"tags? (includes?|do(?:es)? not include)\s+#?([\w/\-]+)", line, re.I)):
            neg = "not" in m.group(1).lower()
            c = f'table.find(t.tags, function(tag) return tag:find("{m.group(2)}", 1, true) end)'
            conds.append(f"not ({c})" if neg else c)
        elif (m := re.match(r"path (includes|do(?:es)? not include)\s+(.+)", line, re.I)):
            neg = "not" in m.group(1).lower()
            c = f't.page:find("{m.group(2).strip()}", 1, true)'
            conds.append(f"not ({c})" if neg else c)
        elif (m := re.match(r"description (includes|do(?:es)? not include)\s+(.+)", line, re.I)):
            neg = "not" in m.group(1).lower()
            c = f't.name:find("{m.group(2).strip()}", 1, true)'
            conds.append(f"not ({c})" if neg else c)
        elif (m := re.match(r"sort by (\w+)( reverse)?", low)):
            fmap = {"due": "t.due", "scheduled": "t.scheduled", "start": "t.start",
                    "priority": "t.priority", "created": "t.created",
                    "description": "t.name", "done": "t.completion"}
            f = fmap.get(m.group(1))
            if f:
                order_by = f + (" desc" if m.group(2) else "")
            else:
                unconv.append(line)
        elif (m := re.match(r"limit(?: to)? (\d+)", low)):
            limit = int(m.group(1))
        else:
            unconv.append(line)

    parts = ["from t = index.tasks()"]
    if conds:
        parts.append("where " + " and ".join(conds))
    if order_by:
        parts.append("order by " + order_by)
    if limit is not None:
        parts.append(f"limit {limit}")
    parts.append("select templates.taskItem(t)")
    body = "\n  ".join(parts)
    return f"${{query[[\n  {body}\n]]}}", unconv


TASKS_BLOCK_RE = re.compile(r"^[ \t]*```+\s*tasks\s*\n(.*?)\n[ \t]*```+[ \t]*$",
                            re.MULTILINE | re.DOTALL)


def convert_file_to_sb(text):
    counts = {"converted": 0, "unconverted_lines": 0}

    def repl(match):
        instructions = match.group(1).splitlines()
        sb, unconv = obsidian_block_to_sb(instructions)
        counts["converted"] += 1
        counts["unconverted_lines"] += len(unconv)
        prefix = ""
        if unconv:
            joined = "; ".join(unconv)
            prefix = f"<!-- Obsidian Tasks instructions not auto-converted: {joined} -->\n"
        return prefix + sb

    return TASKS_BLOCK_RE.sub(repl, text), counts


# ----------------------------- SilverBullet -> Obsidian -----------------------------

SB_QUERY_RE = re.compile(r"\$\{query\[\[(.*?)\]\]\}", re.DOTALL)


DATE_COMPOUND_RE = re.compile(
    r't\.(due|scheduled|start|created|completion)\s+and\s+tostring\(t\.\1\)\s*([<>]=?|==)\s*(date\.\w+\(\)|"[\d-]+")')


def sb_query_to_obsidian(body):
    if "index.tasks()" not in body:
        return None, ["not a task query"]
    flat = " ".join(body.split())
    out, unconv = [], []

    where = re.search(r"\bwhere\b(.*?)(\border by\b|\blimit\b|\bselect\b|$)", flat)
    if where:
        where_str = where.group(1).strip()

        def date_repl(m):
            field = "done" if m.group(1) == "completion" else m.group(1)
            cmp = {"<": "before", "<=": "on or before", ">": "after",
                   ">=": "on or after", "==": "on"}.get(m.group(2), m.group(2))
            val = m.group(3)
            kw = {"date.today()": "today", "date.tomorrow()": "tomorrow",
                  "date.yesterday()": "yesterday"}.get(val, val.strip('"'))
            out.append(f"{field} {cmp} {kw}")
            return "\x00"

        where_str = DATE_COMPOUND_RE.sub(date_repl, where_str)
        for c in re.split(r"\s+and\s+", where_str):
            c = c.strip().strip("\x00").strip()
            if not c:
                continue
            cl = c.lower()
            if cl == "not t.done":
                out.append("not done")
            elif cl == "t.done":
                out.append("done")
            elif cl == "not t.due":
                out.append("no due date")
            elif cl == "t.due":
                out.append("has due date")
            elif (m := re.match(r't\.priority == "(\w+)"', c)):
                out.append(f"priority is {m.group(1)}")
            elif (m := re.match(r'table\.find\(t\.tags, function\(tag\) return tag:find\("([\w/\-]+)", 1, true\) end\)', c)):
                out.append(f"tags include #{m.group(1)}")
            elif (m := re.match(r'table\.includes\(t\.tags, "([\w/\-]+)"\)', c)):
                out.append(f"tags include #{m.group(1)}")
            elif (m := re.match(r't\.page:find\("(.+?)", 1, true\)', c)):
                out.append(f"path includes {m.group(1)}")
            elif (m := re.match(r't\.name:find\("(.+?)", 1, true\)', c)):
                out.append(f"description includes {m.group(1)}")
            else:
                unconv.append(c)

    ob = re.search(r"\border by\b\s+t\.(\w+)( desc)?", flat)
    if ob:
        rmap = {"name": "description", "completion": "done"}
        out.append(f"sort by {rmap.get(ob.group(1), ob.group(1))}" + (" reverse" if ob.group(2) else ""))
    lim = re.search(r"\blimit\b\s+(\d+)", flat)
    if lim:
        out.append(f"limit {lim.group(1)}")

    block = "```tasks\n" + "\n".join(out) + "\n```"
    return block, unconv


def convert_file_to_obsidian(text):
    counts = {"converted": 0, "unconverted_lines": 0}

    def repl(match):
        block, unconv = sb_query_to_obsidian(match.group(1))
        if block is None:
            return match.group(0)  # leave non-task queries untouched
        counts["converted"] += 1
        counts["unconverted_lines"] += len(unconv)
        prefix = ""
        if unconv:
            prefix = f"%% Not auto-converted: {'; '.join(unconv)} %%\n"
        return prefix + block

    return SB_QUERY_RE.sub(repl, text), counts


# ----------------------------- driver -----------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path", help="markdown file or folder to convert")
    ap.add_argument("--to", choices=["silverbullet", "obsidian"], required=True)
    ap.add_argument("--in-place", action="store_true",
                    help="rewrite files (saving originals as *.bak); default is preview")
    args = ap.parse_args()

    root = pathlib.Path(args.path)
    files = [root] if root.is_file() else sorted(root.rglob("*.md"))
    convert = convert_file_to_sb if args.to == "silverbullet" else convert_file_to_obsidian

    total_blocks = total_unconv = total_files = 0
    for f in files:
        try:
            text = f.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        new, counts = convert(text)
        if counts["converted"] == 0 or new == text:
            continue
        total_files += 1
        total_blocks += counts["converted"]
        total_unconv += counts["unconverted_lines"]
        if args.in_place:
            f.with_suffix(f.suffix + ".bak").write_text(text, encoding="utf-8")
            f.write_text(new, encoding="utf-8")
            print(f"[updated] {f}  ({counts['converted']} block(s))")
        else:
            print(f"\n===== {f}  ({counts['converted']} block(s)) =====")
            print(new)

    mode = "rewritten" if args.in_place else "previewed"
    print(f"\n{total_blocks} query block(s) {mode} across {total_files} file(s); "
          f"{total_unconv} instruction(s) left for manual review.", file=sys.stderr)
    if not args.in_place and total_blocks:
        print("Re-run with --in-place to apply (originals saved as .bak).", file=sys.stderr)


if __name__ == "__main__":
    main()