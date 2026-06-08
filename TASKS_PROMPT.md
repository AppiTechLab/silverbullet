# Obsidian Tasks-style task management for SilverBullet (inline attributes)

Task metadata is stored as SilverBullet inline attributes — already natively indexed,
no custom parser needed. The task format is:

```
- [ ] Write report [due:: 2026-06-15] [priority:: high] [scheduled:: 2026-06-10] [recurrence:: every week]
```

Supported attribute keys: `due`, `scheduled`, `start`, `priority`, `recurrence`, `done`.

`priority` values: `highest`, `high`, `medium`, `low`, `lowest`.

Because `collectAttributes` in `plugs/index/item.ts` already reads all `[key:: value]`
attributes and sets them directly on `TaskObject` (via `item[key] = value`), fields like
`t.due`, `t.priority`, `t.recurrence` are **already queryable with zero indexing changes**.

---

## Part 1 — Attribute helpers

Create `plug-api/lib/task_attrs.ts` — small utilities for reading and writing
`[key:: value]` strings in task text (used by the toggle handler and the edit modal):

```ts
/** Read a single attribute value from raw task text. Returns undefined if absent. */
export function getAttr(text: string, key: string): string | undefined {
  const m = text.match(new RegExp(`\\[${key}::\\s*([^\\]]+)\\]`));
  return m?.[1]?.trim();
}

/** Set (or add) an attribute in raw task text. Replaces existing if present. */
export function setAttr(text: string, key: string, value: string): string {
  const re = new RegExp(`\\[${key}::\\s*[^\\]]*\\]`);
  const replacement = `[${key}:: ${value}]`;
  return re.test(text) ? text.replace(re, replacement) : `${text} ${replacement}`;
}

/** Remove an attribute from raw task text. */
export function removeAttr(text: string, key: string): string {
  return text.replace(new RegExp(`\\s*\\[${key}::\\s*[^\\]]*\\]`), "").trim();
}

/** Today as YYYY-MM-DD in local time. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Advance a YYYY-MM-DD date by a recurrence rule.
 * Supports: "every day/week/month/year", "every N days/weeks/months/years",
 * "every Monday/Tuesday/…"
 * Returns null if the rule is unrecognised.
 */
export function nextRecurrence(fromDate: string, rule: string): string | null {
  const d = new Date(fromDate + "T00:00:00");
  const r = rule.toLowerCase().trim();

  const everyN = r.match(/^every\s+(\d+)\s+(day|week|month|year)s?$/);
  if (everyN) {
    const n = parseInt(everyN[1]);
    const unit = everyN[2];
    if (unit === "day") d.setDate(d.getDate() + n);
    else if (unit === "week") d.setDate(d.getDate() + n * 7);
    else if (unit === "month") d.setMonth(d.getMonth() + n);
    else if (unit === "year") d.setFullYear(d.getFullYear() + n);
    return d.toISOString().slice(0, 10);
  }

  const simple = r.match(/^every\s+(day|week|month|year)$/);
  if (simple) {
    const unit = simple[1];
    if (unit === "day") d.setDate(d.getDate() + 1);
    else if (unit === "week") d.setDate(d.getDate() + 7);
    else if (unit === "month") d.setMonth(d.getMonth() + 1);
    else if (unit === "year") d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  }

  const weekday = r.match(
    /^every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/,
  );
  if (weekday) {
    const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
    const target = days.indexOf(weekday[1]);
    do { d.setDate(d.getDate() + 1); } while (d.getDay() !== target);
    return d.toISOString().slice(0, 10);
  }

  return null;
}
```

---

## Part 2 — Task attribute badge rendering

The existing `attributePlugin()` in `client/codemirror/attribute.ts` already wraps
`[key:: value]` spans with a `sb-attribute` class, but renders them as plain colored
text. Extend it so that **task-relevant attributes inside a Task node** are rendered
as visual pill badges instead.

Modify `client/codemirror/attribute.ts`:

```ts
import { syntaxTree } from "@codemirror/language";
import { Decoration, WidgetType } from "@codemirror/view";
import { decoratorStateField, isCursorInRange } from "./util.ts";
import { todayISO } from "../../plug-api/lib/task_attrs.ts";

// Attribute keys that get badge treatment inside tasks
const TASK_BADGE_KEYS = new Set(["due", "scheduled", "start", "priority", "recurrence"]);

const PRIORITY_STYLES: Record<string, string> = {
  highest: "sb-task-badge-priority-highest",
  high:    "sb-task-badge-priority-high",
  medium:  "sb-task-badge-priority-medium",
  low:     "sb-task-badge-priority-low",
  lowest:  "sb-task-badge-priority-lowest",
};

const PRIORITY_ICONS: Record<string, string> = {
  highest: "🔺", high: "⏫", medium: "🔼", low: "🔽", lowest: "⏬",
};

class TaskBadgeWidget extends WidgetType {
  constructor(readonly key: string, readonly value: string) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    const today = todayISO();

    if (this.key === "priority") {
      span.className = `sb-task-badge ${PRIORITY_STYLES[this.value] ?? "sb-task-badge-priority-low"}`;
      span.textContent = `${PRIORITY_ICONS[this.value] ?? ""} ${this.value}`;
    } else if (this.key === "due") {
      const isOverdue = this.value < today;
      const isToday = this.value === today;
      span.className = `sb-task-badge ${isOverdue ? "sb-task-badge-due-overdue" : isToday ? "sb-task-badge-due-today" : "sb-task-badge-due"}`;
      span.textContent = `📅 ${formatDate(this.value)}`;
    } else if (this.key === "scheduled") {
      span.className = "sb-task-badge sb-task-badge-scheduled";
      span.textContent = `⏳ ${formatDate(this.value)}`;
    } else if (this.key === "start") {
      span.className = "sb-task-badge sb-task-badge-start";
      span.textContent = `🛫 ${formatDate(this.value)}`;
    } else if (this.key === "recurrence") {
      span.className = "sb-task-badge sb-task-badge-recurrence";
      span.textContent = `🔁 ${this.value}`;
    }

    return span;
  }

  eq(other: TaskBadgeWidget): boolean {
    return this.key === other.key && this.value === other.value;
  }
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function attributePlugin() {
  return decoratorStateField((state) => {
    const widgets: any[] = [];

    syntaxTree(state).iterate({
      enter: (node) => {
        if (node.type.name !== "Attribute") return;
        if (isCursorInRange(state, [node.from, node.to])) return;

        const attributeText = state.sliceDoc(node.from, node.to);
        const colonIdx = attributeText.indexOf("::");
        if (colonIdx === -1) return;

        const key = attributeText.slice(1, colonIdx).trim();
        const value = attributeText.slice(colonIdx + 2, -1).trim();

        // Check if this attribute is inside a Task node
        let insideTask = false;
        syntaxTree(state).iterate({
          from: node.from,
          to: node.to,
          enter: () => {},
        });
        // Walk ancestors to check for Task node
        let cur = syntaxTree(state).resolveInner(node.from, 1);
        while (cur.parent) {
          cur = cur.parent;
          if (cur.type.name === "Task") { insideTask = true; break; }
        }

        if (insideTask && TASK_BADGE_KEYS.has(key)) {
          // Replace the entire [key:: value] with a badge widget
          widgets.push(
            Decoration.replace({
              widget: new TaskBadgeWidget(key, value),
            }).range(node.from, node.to),
          );
        } else {
          // Default: mark with sb-attribute class (existing behaviour)
          widgets.push(
            Decoration.mark({
              tagName: "span",
              class: "sb-attribute",
              attributes: { [`data-${key}`]: value },
            }).range(node.from, node.to),
          );
        }
      },
    });

    return Decoration.set(widgets, true);
  });
}
```

**CSS in `client/styles/editor.scss`:**

```scss
.sb-task-badge {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 20px;
  margin-left: 4px;
  vertical-align: middle;
  line-height: 1.6;
  cursor: default;
}

.sb-task-badge-priority-highest { background: #fee2e2; color: #dc2626; }
.sb-task-badge-priority-high    { background: #ffedd5; color: #ea580c; }
.sb-task-badge-priority-medium  { background: #fefce8; color: #ca8a04; }
.sb-task-badge-priority-low     { background: #eff6ff; color: #2563eb; }
.sb-task-badge-priority-lowest  { background: var(--color-background-secondary); color: var(--color-text-secondary); }

.sb-task-badge-due-overdue { background: #fee2e2; color: #dc2626; }
.sb-task-badge-due-today   { background: #ffedd5; color: #ea580c; }
.sb-task-badge-due         { background: var(--color-background-secondary); color: var(--color-text-secondary); }
.sb-task-badge-scheduled   { background: var(--color-background-secondary); color: var(--color-text-tertiary); }
.sb-task-badge-start       { background: var(--color-background-secondary); color: var(--color-text-tertiary); }
.sb-task-badge-recurrence  { background: var(--color-background-secondary); color: var(--color-text-tertiary); }
```

---

## Part 3 — Toggle done with date stamp and recurrence

In `plugs/index/task.ts`, extend the `cycleTaskState` function. When toggling an
incomplete task to done, read the raw task line text, check for `[recurrence:: ...]`,
and either advance the due date or stamp `[done:: date]`.

Import at the top of `plugs/index/task.ts`:

```ts
import {
  getAttr,
  setAttr,
  removeAttr,
  todayISO,
  nextRecurrence,
} from "../../plug-api/lib/task_attrs.ts";
```

Inside `cycleTaskState`, replace the `incompleteStates.includes(stateText)` branch:

```ts
if (incompleteStates.includes(stateText)) {
  // Get the full raw task node text to inspect attributes
  const taskNode = node.parent!;           // Task node (contains state + text)
  let taskText = renderToText(taskNode).trim(); // e.g. "[ ] My task [due:: 2026-06-15] [recurrence:: every week]"

  const recurrence = getAttr(taskText, "recurrence");

  if (recurrence) {
    // Recurring: advance due date, keep task incomplete
    const currentDue = getAttr(taskText, "due") ?? todayISO();
    const nextDue = nextRecurrence(currentDue, recurrence);
    if (nextDue) {
      taskText = setAttr(taskText, "due", nextDue);
    }
    // Remove any previous [done:: ...] stamp
    taskText = removeAttr(taskText, "done");
    // Rewrite the task node in the document (state stays as " ")
    await editor.dispatch({
      changes: {
        from: taskNode.from!,
        to: taskNode.to!,
        insert: taskText,
      },
    });
    return; // Do not fall through to state change
  } else {
    // Non-recurring: mark done and stamp [done:: today]
    changeTo = "x";
    const rawText = taskText.replace(/^\[.\]\s*/, ""); // strip the [ ] prefix
    const stamped = setAttr(rawText, "done", todayISO());
    // We need two changes: update the state char AND update the task text
    await editor.dispatch({
      changes: [
        {
          from: node.children![1].from,
          to: node.children![1].to,
          insert: "x",
        },
        {
          from: taskNode.children![1].from, // position right after [ ]
          to: taskNode.to!,
          insert: " " + stamped,
        },
      ],
    });
    await events.dispatchEvent("task:stateChange", {
      from: taskNode.from,
      to: taskNode.to,
      newState: "x",
      text: renderToText(taskNode),
    });
    return;
  }
}
// (The custom state cycling below stays unchanged)
```

---

## Part 4 — Task edit modal

Create `client/components/TaskEditModal.tsx`:

```tsx
import { h, type FunctionComponent } from "preact";
import { useState } from "preact/hooks";

type Priority = "highest" | "high" | "medium" | "low" | "lowest" | "";

type TaskAttrs = {
  due: string;
  scheduled: string;
  start: string;
  priority: Priority;
  recurrence: string;
};

type Props = {
  initialText: string;   // task description without [key:: value] blocks
  initialAttrs: TaskAttrs;
  onSave: (text: string, attrs: TaskAttrs) => void;
  onCancel: () => void;
};

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "",         label: "None" },
  { value: "lowest",  label: "⏬ Lowest" },
  { value: "low",     label: "🔽 Low" },
  { value: "medium",  label: "🔼 Medium" },
  { value: "high",    label: "⏫ High" },
  { value: "highest", label: "🔺 Highest" },
];

export const TaskEditModal: FunctionComponent<Props> = ({
  initialText,
  initialAttrs,
  onSave,
  onCancel,
}) => {
  const [text, setText] = useState(initialText);
  const [attrs, setAttrs] = useState<TaskAttrs>({ ...initialAttrs });

  const set = (patch: Partial<TaskAttrs>) =>
    setAttrs((a) => ({ ...a, ...patch }));

  return (
    <div class="sb-modal-overlay" onClick={onCancel}>
      <div class="sb-modal-content sb-task-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Edit Task</h3>

        <label>Description
          <input type="text" class="sb-input" value={text} autofocus
            onInput={(e) => setText((e.target as HTMLInputElement).value)} />
        </label>

        <label>Priority
          <select class="sb-select" value={attrs.priority}
            onChange={(e) => set({ priority: (e.target as HTMLSelectElement).value as Priority })}>
            {PRIORITIES.map((p) => <option value={p.value}>{p.label}</option>)}
          </select>
        </label>

        <label>Due date
          <input type="date" class="sb-input" value={attrs.due}
            onChange={(e) => set({ due: (e.target as HTMLInputElement).value })} />
        </label>

        <label>Scheduled date
          <input type="date" class="sb-input" value={attrs.scheduled}
            onChange={(e) => set({ scheduled: (e.target as HTMLInputElement).value })} />
        </label>

        <label>Start date
          <input type="date" class="sb-input" value={attrs.start}
            onChange={(e) => set({ start: (e.target as HTMLInputElement).value })} />
        </label>

        <label>Recurrence
          <input type="text" class="sb-input" value={attrs.recurrence}
            placeholder="every week · every month · every Monday"
            onInput={(e) => set({ recurrence: (e.target as HTMLInputElement).value })} />
        </label>

        <div class="sb-modal-actions">
          <button class="sb-button sb-button-primary" onClick={() => onSave(text, attrs)}>Save</button>
          <button class="sb-button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
};
```

**Wiring:** Register a slash command `/task-edit` and keyboard shortcut `Ctrl+Shift+T`
in the plug manifest (`plugs/index/index.plug.yaml`). The handler should:

1. Get the cursor position via `editor.getCursor()`
2. Parse the markdown tree, find the `Task` node at that position
3. Extract the task description (text after `[ ]`, minus all `[key:: value]` blocks)
4. Extract current attribute values using `getAttr()`
5. Mount `TaskEditModal` via the SilverBullet overlay/modal system
6. On save, rebuild the task line:
   ```ts
   import { setAttr, removeAttr } from "../../plug-api/lib/task_attrs.ts";

   let line = `* [ ] ${text}`;
   if (attrs.priority)   line = setAttr(line, "priority",   attrs.priority);
   if (attrs.due)        line = setAttr(line, "due",        attrs.due);
   if (attrs.scheduled)  line = setAttr(line, "scheduled",  attrs.scheduled);
   if (attrs.start)      line = setAttr(line, "start",      attrs.start);
   if (attrs.recurrence) line = setAttr(line, "recurrence", attrs.recurrence);
   // dispatch the change to the editor
   ```

---

## Part 5 — Lua query helpers

**5a — Add `templates.taskItemFull`** in
`libraries/Library/Std/Infrastructure/Query Templates.md`,
inside the existing `space-lua` block:

```lua
-- Renders a task with inline-attribute metadata shown as emoji badges
templates.taskItemFull = template.new([==[
* [${state}] [[${string.find(ref, "[@#]") and ref or "$" .. ref}]] ${name}${priority and (" [priority:: " .. priority .. "]") or ""}${due and (" [due:: " .. due .. "]") or ""}${scheduled and (" [scheduled:: " .. scheduled .. "]") or ""}${recurrence and (" [recurrence:: " .. recurrence .. "]") or ""}
]==])
```

> When rendered in the editor, the `[key:: value]` parts will automatically be
> displayed as pill badges by the updated `attributePlugin()` from Part 2.

**5b — Create `libraries/Library/Std/Tasks.md`:**

````md
---
tags: meta
---
Helper functions for querying tasks.

```space-lua
-- priority: 10
tasks = tasks or {}

function tasks.today()
  return os.date("%Y-%m-%d")
end

function tasks.tomorrow()
  return os.date("%Y-%m-%d", os.time() + 86400)
end

-- Convenience query with filtering, sorting and limiting.
-- Options:
--   notDone (bool)
--   dueBefore (string)   — YYYY-MM-DD
--   dueAfter (string)
--   dueToday (bool)
--   priority (string)    — "highest"|"high"|"medium"|"low"|"lowest"
--   tag (string)
--   orderBy (string)     — "due"|"priority"|"scheduled"
--   limit (number)
--   template (fn)        — defaults to templates.taskItemFull
function tasks.query(opts)
  opts = opts or {}
  local renderFn = opts.template or templates.taskItemFull

  local results = query[[from t = index.tasks() select t]]

  local filtered = {}
  for _, t in ipairs(results) do
    local ok = true
    if opts.notDone ~= nil then ok = ok and (not t.done == opts.notDone) end
    if opts.dueBefore   then ok = ok and (t.due ~= nil and t.due < opts.dueBefore) end
    if opts.dueAfter    then ok = ok and (t.due ~= nil and t.due > opts.dueAfter) end
    if opts.dueToday    then ok = ok and (t.due == tasks.today()) end
    if opts.priority    then ok = ok and (t.priority == opts.priority) end
    if opts.tag         then ok = ok and table.includes(t.itags or {}, opts.tag) end
    if ok then table.insert(filtered, t) end
  end

  if opts.orderBy == "due" then
    table.sort(filtered, function(a, b)
      return (a.due or "9999-99-99") < (b.due or "9999-99-99")
    end)
  elseif opts.orderBy == "priority" then
    local order = {highest=0, high=1, medium=2, low=3, lowest=4}
    table.sort(filtered, function(a, b)
      return (order[a.priority or ""] or 5) < (order[b.priority or ""] or 5)
    end)
  elseif opts.orderBy == "scheduled" then
    table.sort(filtered, function(a, b)
      return (a.scheduled or "9999-99-99") < (b.scheduled or "9999-99-99")
    end)
  end

  if opts.limit then
    local limited = {}
    for i = 1, math.min(opts.limit, #filtered) do
      table.insert(limited, filtered[i])
    end
    filtered = limited
  end

  local lines = {}
  for _, t in ipairs(filtered) do
    table.insert(lines, renderFn(t))
  end

  if #lines == 0 then return widget.new{} end
  return widget.markdown(table.concat(lines))
end
```
````

**Usage examples:**

```
${tasks.query { notDone = true, dueBefore = tasks.today(), orderBy = "due" }}

${tasks.query { notDone = true, dueToday = true, orderBy = "priority" }}

${tasks.query { notDone = true, priority = "high", limit = 10 }}

${query[[
  from t = index.tasks()
  where not t.done and t.due != nil
  order by t.due
  select templates.taskItemFull(t)
]]}
```

Toggling a checkbox in a rendered query result works automatically via the existing
`updateTaskState` / `cycleTaskStateByRef` functions — `templates.taskItemFull` embeds
`[[ref]]` wikilinks in every rendered task, which SilverBullet uses to locate and
update the source file.

---

## Files changed / created

| File | Action |
|---|---|
| `plug-api/lib/task_attrs.ts` | NEW — `getAttr`, `setAttr`, `removeAttr`, `todayISO`, `nextRecurrence` |
| `plugs/index/task.ts` | EDIT — toggle done stamps `[done:: date]`, handles recurrence |
| `client/codemirror/attribute.ts` | EDIT — render task attributes as pill badges |
| `client/styles/editor.scss` | EDIT — badge CSS |
| `client/components/TaskEditModal.tsx` | NEW — edit modal |
| `libraries/Library/Std/Infrastructure/Query Templates.md` | EDIT — add `templates.taskItemFull` |
| `libraries/Library/Std/Tasks.md` | NEW — `tasks.query`, `tasks.today`, `tasks.tomorrow` |
