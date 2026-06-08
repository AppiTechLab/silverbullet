# Lab Dashboard

${
  local today = os.date("%Y-%m-%d")
  local weekEnd = os.date("%Y-%m-%d", os.time() + 7 * 86400)

  local overdue = query[[
    from t = index.tasks()
    where not t.done and t.due ~= nil and t.due < os.date("%Y-%m-%d")
    order by t.due
    select templates.taskItem(t)
  ]]

  local dueToday = query[[
    from t = index.tasks()
    where not t.done and t.due == os.date("%Y-%m-%d")
    order by t.page
    select templates.taskItem(t)
  ]]

  local md = ""

  if #overdue > 0 then
    md = md .. "## ⚠️ Overdue\n" .. table.concat(overdue) .. "\n"
  end

  if #dueToday > 0 then
    md = md .. "## Today\n" .. table.concat(dueToday) .. "\n"
  elseif #overdue == 0 then
    md = md .. "*Nothing due today.*\n"
  end

  return widget.markdown(md)
}

---

## Ongoing projects

${
  local weekEnd = os.date("%Y-%m-%d", os.time() + 7 * 86400)

  local tasks = query[[
    from t = index.tasks()
    where not t.done and t.due ~= nil
      and t.due <= weekEnd
      and string.find(t.page, "^Projects/")
    order by t.due
    select templates.taskItem(t)
  ]]

  local pages = query[[
    from p = index.pages()
    where string.find(p.name, "^Projects/")
    order by p.lastModified desc
    limit 5
    select templates.pageItem(p)
  ]]

  local md = ""
  if #tasks > 0 then
    md = md .. "**Due this week**\n\n" .. table.concat(tasks) .. "\n"
  else
    md = md .. "*No tasks due this week.*\n\n"
  end
  md = md .. "**Recent pages**\n\n" .. table.concat(pages)

  return widget.markdown(md)
}

---

## Project acquisition

${
  local weekEnd = os.date("%Y-%m-%d", os.time() + 7 * 86400)

  local tasks = query[[
    from t = index.tasks()
    where not t.done and t.due ~= nil
      and t.due <= weekEnd
      and string.find(t.page, "^Acquisition/")
    order by t.due
    select templates.taskItem(t)
  ]]

  local pages = query[[
    from p = index.pages()
    where string.find(p.name, "^Acquisition/")
    order by p.lastModified desc
    limit 5
    select templates.pageItem(p)
  ]]

  local md = ""
  if #tasks > 0 then
    md = md .. "**Due this week**\n\n" .. table.concat(tasks) .. "\n"
  else
    md = md .. "*No tasks due this week.*\n\n"
  end
  md = md .. "**Recent pages**\n\n" .. table.concat(pages)

  return widget.markdown(md)
}

---

## Teaching

${
  local weekEnd = os.date("%Y-%m-%d", os.time() + 7 * 86400)

  local tasks = query[[
    from t = index.tasks()
    where not t.done and t.due ~= nil
      and t.due <= weekEnd
      and string.find(t.page, "^Teaching/")
    order by t.due
    select templates.taskItem(t)
  ]]

  local pages = query[[
    from p = index.pages()
    where string.find(p.name, "^Teaching/")
    order by p.lastModified desc
    limit 5
    select templates.pageItem(p)
  ]]

  local md = ""
  if #tasks > 0 then
    md = md .. "**Due this week**\n\n" .. table.concat(tasks) .. "\n"
  else
    md = md .. "*No tasks due this week.*\n\n"
  end
  md = md .. "**Recent pages**\n\n" .. table.concat(pages)

  return widget.markdown(md)
}

---

## Lab management

${
  local weekEnd = os.date("%Y-%m-%d", os.time() + 7 * 86400)

  local tasks = query[[
    from t = index.tasks()
    where not t.done and t.due ~= nil
      and t.due <= weekEnd
      and string.find(t.page, "^Lab/")
    order by t.due
    select templates.taskItem(t)
  ]]

  local pages = query[[
    from p = index.pages()
    where string.find(p.name, "^Lab/")
    order by p.lastModified desc
    limit 5
    select templates.pageItem(p)
  ]]

  local md = ""
  if #tasks > 0 then
    md = md .. "**Due this week**\n\n" .. table.concat(tasks) .. "\n"
  else
    md = md .. "*No tasks due this week.*\n\n"
  end
  md = md .. "**Recent pages**\n\n" .. table.concat(pages)

  return widget.markdown(md)
}

---

## Personal

${
  local weekEnd = os.date("%Y-%m-%d", os.time() + 7 * 86400)

  local tasks = query[[
    from t = index.tasks()
    where not t.done and t.due ~= nil
      and t.due <= weekEnd
      and string.find(t.page, "^Personal/")
    order by t.due
    select templates.taskItem(t)
  ]]

  local pages = query[[
    from p = index.pages()
    where string.find(p.name, "^Personal/")
    order by p.lastModified desc
    limit 5
    select templates.pageItem(p)
  ]]

  local md = ""
  if #tasks > 0 then
    md = md .. "**Due this week**\n\n" .. table.concat(tasks) .. "\n"
  else
    md = md .. "*No tasks due this week.*\n\n"
  end
  md = md .. "**Recent pages**\n\n" .. table.concat(pages)

  return widget.markdown(md)
}
