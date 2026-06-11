#meta

Implements a kanban board widget powered by Space Lua.

## Usage

Inline in any page:

```
${widgets.kanban()}
```

With options:

```
${widgets.kanban({
  columns = {"Backlog", "In Progress", "Review", "Done"},
  tag = "project",
  page = "My Project"
})}
```

Or as a fenced code block (body is an optional Lua table of options):

````
```kanban
{columns = {"Todo", "Doing", "Done"}, tag = "sprint"}
```
````

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `columns` | string[] | `{"Todo","In Progress","Done"}` | Column names. A task lands in a column when it has a matching tag (lowercase, spaces → hyphens). |
| `tag` | string | — | Only show tasks that carry this tag. |
| `page` | string | — | Only show tasks from this page. |

### Tagging tasks to columns

Add the column tag to a task to assign it to that column:

```
- [ ] Write tests #in-progress
- [ ] Deploy to staging #todo
- [ ] Update docs #done
```

Tasks without a matching column tag are not shown (to keep the board clean).

## Implementation

```space-lua
-- priority: 10

-- HTML-escape helper (used inside the kanban builder)
local function _kbEsc(s)
  s = tostring(s or "")
  s = s:gsub("&", "&amp;")
  s = s:gsub("<", "&lt;")
  s = s:gsub(">", "&gt;")
  s = s:gsub('"', "&quot;")
  return s
end

-- Normalize a column label to its tag key
-- "In Progress" → "in-progress"
local function _kbTag(label)
  return label:lower():gsub(" ", "-")
end

-- Kanban board widget
-- Returns widget.htmlBlock containing a self-styled kanban.
function widgets.kanban(opts)
  opts = opts or {}
  local columns  = opts.columns  or {"Todo", "In Progress", "Done"}
  local filterTag  = opts.tag
  local filterPage = opts.page

  -- Build ordered list of {label, key, tasks=[]}
  local cols = {}
  local colByKey = {}
  for _, label in ipairs(columns) do
    local key = _kbTag(label)
    local col = { label = label, key = key, tasks = {} }
    table.insert(cols, col)
    colByKey[key] = col
  end

  -- Query all undone tasks
  local all_tasks = query[[from t = index.tasks() where not t.done]]

  for _, t in ipairs(all_tasks) do
    -- Apply optional filters
    local skip = false
    if filterPage and t.page ~= filterPage then skip = true end
    if filterTag and not table.includes(t.itags or {}, filterTag) then skip = true end

    if not skip then
      -- Find the first matching column
      for _, col in ipairs(cols) do
        if table.includes(t.itags or {}, col.key) then
          table.insert(col.tasks, t)
          break
        end
      end
    end
  end

  -- Build HTML ---------------------------------------------------------------
  local css = [[<style>
.sb-kanban{display:flex;gap:12px;overflow-x:auto;padding:4px 0;align-items:flex-start;font-family:inherit}
.sb-kanban-col{flex:0 0 210px;background:var(--subtle-background-color,rgba(0,0,0,.06));border-radius:8px;padding:8px 10px;min-height:60px}
.sb-kanban-title{font-size:.76em;font-weight:700;text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;color:var(--subtle-color,#666)}
.sb-kanban-badge{background:var(--ui-accent-color,#5c5cff);color:var(--ui-accent-contrast-color,#fff);border-radius:9px;padding:1px 7px;font-size:.8em;font-weight:600}
.sb-kanban-card{background:var(--panel-background-color,#fff);border:1px solid rgba(0,0,0,.08);border-radius:5px;padding:5px 8px;margin-bottom:5px;font-size:.84em;line-height:1.4;word-break:break-word}
.sb-kanban-ref{font-size:.72em;color:var(--subtle-color,#888);margin-top:2px}
.sb-kanban-empty{font-size:.8em;text-align:center;padding:8px 0;color:var(--subtle-color,#bbb);font-style:italic}
html[data-theme="dark"] .sb-kanban-col{background:rgba(255,255,255,.06)}
html[data-theme="dark"] .sb-kanban-card{background:#2c2c2c;border-color:rgba(255,255,255,.09);color:#ddd}
html[data-theme="dark"] .sb-kanban-title{color:#aaa}
html[data-theme="dark"] .sb-kanban-ref{color:#777}
</style>]]

  local colsHtml = ""
  for _, col in ipairs(cols) do
    local count = #col.tasks
    local cardsHtml = ""
    if count == 0 then
      cardsHtml = '<div class="sb-kanban-empty">—</div>'
    else
      for _, t in ipairs(col.tasks) do
        cardsHtml = cardsHtml
          .. '<div class="sb-kanban-card">'
          .. _kbEsc(t.name)
          .. '<div class="sb-kanban-ref">[[' .. _kbEsc(t.page) .. ']]</div>'
          .. '</div>'
      end
    end
    colsHtml = colsHtml
      .. '<div class="sb-kanban-col">'
      .. '<div class="sb-kanban-title">'
      .. _kbEsc(col.label)
      .. ' <span class="sb-kanban-badge">' .. count .. '</span>'
      .. '</div>'
      .. cardsHtml
      .. '</div>'
  end

  return widget.htmlBlock(css .. '<div class="sb-kanban">' .. colsHtml .. '</div>')
end
```
