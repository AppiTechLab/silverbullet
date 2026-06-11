# Kanban Widget Test

## Default board (all tasks, default columns)

${widgets.kanban()}

---

## Project board (filtered by tag)

${widgets.kanban({
  columns = {"Backlog", "In Progress", "Review", "Done"},
  tag = "website"
})}

---

## Current-page board

${widgets.kanban({
  columns = {"Todo", "Doing", "Done"},
  page = "Kanban Test"
})}

---

## Fenced code block syntax

```kanban
{columns = {"Todo", "In Progress", "Done"}, tag = "website"}
```

---

# Sample tasks

Use these to verify cards appear in the correct columns.

## Default column tasks

- [ ] Fix login bug #todo
- [ ] Write unit tests #todo
- [ ] Review pull request #in-progress
- [ ] Update API docs #in-progress
- [x] Deploy to staging #done

## Website project tasks

- [ ] Design homepage mockup #backlog #website
- [ ] Implement hero section #in-progress #website
- [ ] Code review hero PR #review #website
- [ ] Ship new footer #done #website

## Edge cases

- [ ] Task with no column tag (should not appear on board)
- [ ] Task with multiple tags #todo #website (should land in first matching column)
