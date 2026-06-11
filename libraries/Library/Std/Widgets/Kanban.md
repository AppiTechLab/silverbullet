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

-- Escape a string for embedding in a single-quoted JS string literal
local function _kbJs(s)
  s = tostring(s or "")
  s = s:gsub("\\", "\\\\")
  s = s:gsub("'", "\\'")
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
.sb-kanban{display:flex;gap:16px;overflow-x:auto;padding:8px 2px 14px;align-items:flex-start;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}
.sb-kanban::-webkit-scrollbar{height:8px}
.sb-kanban::-webkit-scrollbar-track{background:#f1f5f9;border-radius:8px}
.sb-kanban::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:8px}
.sb-kanban::-webkit-scrollbar-thumb:hover{background:#94a3b8}
.sb-kanban-col{flex:0 0 260px;display:flex;flex-direction:column;min-height:80px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 4px 6px -1px rgba(0,0,0,.05),0 2px 4px -1px rgba(0,0,0,.03);transition:box-shadow .2s ease}
.sb-kanban-col:hover{box-shadow:0 10px 15px -3px rgba(0,0,0,.08),0 4px 6px -2px rgba(0,0,0,.04)}
.sb-kanban-title{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #e2e8f0;font-size:.88em;font-weight:600;color:#334155}
.sb-kanban-title span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-kanban-badge{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-width:24px;height:22px;padding:0 8px;background:#f1f5f9;color:#64748b;font-size:.78em;font-weight:600;border-radius:12px}
.sb-kanban-content{display:flex;flex-direction:column;gap:10px;padding:12px;overflow-y:auto;max-height:70vh;scrollbar-width:none}
.sb-kanban-content::-webkit-scrollbar{display:none}
.sb-kanban-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px;font-size:.86em;font-weight:500;line-height:1.45;color:#1e293b;word-break:break-word;box-shadow:0 1px 3px rgba(0,0,0,.04);transition:all .2s ease}
.sb-kanban-card:hover{border-color:#cbd5e1;box-shadow:0 4px 6px -1px rgba(0,0,0,.08);transform:translateY(-2px)}
.sb-kanban-ref{display:block;font-size:.78em;font-weight:400;color:#94a3b8;margin-top:8px;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sb-kanban-ref:hover{color:#6366f1;text-decoration:underline}
.sb-kanban-empty{font-size:.8em;text-align:center;padding:14px 0;color:#cbd5e1;font-style:italic}
html[data-theme="dark"] .sb-kanban::-webkit-scrollbar-track{background:rgba(255,255,255,.05)}
html[data-theme="dark"] .sb-kanban::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15)}
html[data-theme="dark"] .sb-kanban-col{background:#1f2228;border-color:rgba(255,255,255,.08);box-shadow:0 4px 6px -1px rgba(0,0,0,.3)}
html[data-theme="dark"] .sb-kanban-title{color:#cbd5e1;border-bottom-color:rgba(255,255,255,.08)}
html[data-theme="dark"] .sb-kanban-badge{background:rgba(255,255,255,.08);color:#94a3b8}
html[data-theme="dark"] .sb-kanban-card{background:#2a2d35;border-color:rgba(255,255,255,.09);color:#e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,.3)}
html[data-theme="dark"] .sb-kanban-card:hover{border-color:rgba(255,255,255,.2)}
html[data-theme="dark"] .sb-kanban-ref{color:#64748b}
html[data-theme="dark"] .sb-kanban-ref:hover{color:#8b8bff}
html[data-theme="dark"] .sb-kanban-empty{color:#475569}
</style>]]

  local colsHtml = ""
  for _, col in ipairs(cols) do
    local count = #col.tasks
    local cardsHtml = ""
    if count == 0 then
      cardsHtml = '<div class="sb-kanban-empty">—</div>'
    else
      for _, t in ipairs(col.tasks) do
        local navJs = "syscall('editor.navigate', '" .. _kbJs(t.page) .. "');return false;"
        cardsHtml = cardsHtml
          .. '<div class="sb-kanban-card">'
          .. _kbEsc(t.name)
          .. '<a class="sb-kanban-ref" href="#" onclick="' .. _kbEsc(navJs) .. '">'
          .. _kbEsc(t.page) .. '</a>'
          .. '</div>'
      end
    end
    colsHtml = colsHtml
      .. '<div class="sb-kanban-col">'
      .. '<div class="sb-kanban-title">'
      .. '<span>' .. _kbEsc(col.label) .. '</span>'
      .. '<span class="sb-kanban-badge">' .. count .. '</span>'
      .. '</div>'
      .. '<div class="sb-kanban-content">' .. cardsHtml .. '</div>'
      .. '</div>'
  end

  return widget.htmlBlock(css .. '<div class="sb-kanban">' .. colsHtml .. '</div>')
end
```
