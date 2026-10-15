export const taskTemplate = `---
schema_version: 1
type: task
title: Untitled task
status: inbox
scheduled:
due:
reminder_at:
repeat:
project:
focus: false
trashed: false
tags: []
---

## Notes

Add any context you need here.

## Checklist

- [ ] Your next step
`;
export const taskBase = `filters:
  and:
    - 'file.ext == "md"'
    - 'file.inFolder("Tasks")'
    - 'type == "task"'
views:
  - type: table
    name: Tasks
    order: [title, status, scheduled, due, project]
`;
