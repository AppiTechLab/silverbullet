#meta

Implements some useful general purpose widgets. Specifically:

## Buttons
Types of button widgets:

* `widgets.button(text, callback)` renders a simple button running the callback when clicked
* `widgets.commandButton(commandName)` renders a button for a particular command (where the button text is the command name itself)
* `widgets.commandButton(text, commandName)` renders a button for a particular command with a custom button text
* `widgets.commandButton(text, commandName, args)` renders a button for a particular command and arguments (specified as a table list) with a custom button text

Examples:

${widgets.button("Hello", function()
  editor.flashNotification "Hi there!"
end)}

${widgets.commandButton("System: Reload")}

## Top and bottom widgets
* Linked mentions: show a list of links that link to the current page, at the bottom of your page
* Linked tasks: shows a list of tasks that link to the current page, at the top of the page

These can each be individually enabled/disabled and configured in your `CONFIG` page (use `space-lua` instead of `lua`):

```lua
-- Disable linked mentions altogether
config.set("std.widgets.linkedMentions.enabled", false)
-- Disable linked tasks altogether
config.set("std.widgets.linkedTasks.enabled", false)
```

# Implementation

## Buttons
```space-lua
-- priority: 10
function widgets.button(text, callback, attrs)
  local buttonEl = {
    onclick = callback,
    text
  }

  -- attrs can be used for additional customization
  if attrs then
    for k, v in pairs(attrs) do
      buttonEl[k] = v
    end
  end

  return widget.html(dom.button(buttonEl))
end

function widgets.commandButton(text, commandName, args)
  if not commandName then
    -- When only passed one argument, then let's assume it's a command name
    commandName = text
  end
  return widget.html(dom.button {
    onclick = function()
      editor.invokeCommand(commandName, args)
    end,
    text
  })
end

function widgets.subPages(pageName)
  pageName = pageName or editor.getCurrentPage()
  return widget.markdown(table.concat(query[[
    from p = index.subPages(pageName)
    select templates.pageItem(p)
  ]]))
end
```

## Linked mentions
```space-lua
-- priority: 10
widgets = widgets or {}

config.defineCategory {
  name = "Widgets",
  description = "Enable and configure built-in widgets (linked mentions, linked tasks, etc.)",
  priority = 45,
}

local mentionTemplate = template.new [==[
**[[${_.page}@${_.start}]]**:
${_.snippet}

]==]

-- configuration schema
config.define("std.widgets.linkedMentions", {
  type = "object",
  properties = {
    enabled = {
      type = "boolean",
      default = true,
      description = "Show linked mentions at the bottom of pages",
      ui = { category = "Widgets", label = "Linked mentions", priority = 2 },
    },
  }
})

function widgets.linkedMentions(pageName)
  pageName = pageName or editor.getCurrentPage()
  local linkedMentions = query[[
    from r = index.relations()
    where r.page != pageName
      and r.to == pageName
      and r.kind != "co-mention"
    order by r.pageLastModified desc, r.range[1]
    select mentionTemplate({
      page = r.page,
      snippet = r.snippet,
      start = r.range[1],
    })
  ]]
  if #linkedMentions > 0 then
    return widget.new {
      markdown = "# Linked Mentions\n" .. table.concat(linkedMentions)
    }
  end
end
```

### Bottom widget
```space-lua
-- priority: -1
if config.get("std.widgets.linkedMentions.enabled", true) then
  event.listen {
    name = "hooks:renderBottomWidgets",
    run = function(e)
      return widgets.linkedMentions()
    end
  }
end
```

## Linked tasks
```space-lua
-- priority: 10

-- configuration schema
config.define("std.widgets.linkedTasks", {
  type = "object",
  properties = {
    enabled = {
      type = "boolean",
      default = true,
      description = "Show linked tasks at the top of pages",
      ui = { category = "Widgets", label = "Linked tasks", priority = 1 },
    },
  }
})

function widgets.linkedTasks(pageName)
  pageName = pageName or editor.getCurrentPage()
  local tasks = query[[
    from t = index.tasks()
    where not t.done and table.includes(t.ilinks, pageName)
    order by t.page
    select templates.taskItem(t)
  ]]
  local md = ""
  if #tasks > 0 then
    md = "# Linked Tasks\n" .. table.concat(tasks)
  else
    md = ""
  end
  return widget.new {
    markdown = md
  }
end
```

### Top widget
```space-lua
-- priority: -1
if config.get("std.widgets.linkedTasks.enabled", true) then
  event.listen {
    name = "hooks:renderTopWidgets",
    run = function(e)
      return widgets.linkedTasks()
    end
  }
end
```
