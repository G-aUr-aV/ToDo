import test from "node:test";
import assert from "node:assert/strict";
import { checkItems, toggleCheck } from "../core/checklist";
test("only Markdown task list nodes are interactive; code examples are unchanged", () => {
  const body =
    "An example:\n\n```md\n- [ ] Do not toggle this code\n```\n\n- [ ] Real task\n1. [x] An ordered task\n\n    An indented code block\n";
  const items = checkItems(body);
  assert.equal(items.length, 2);
  assert.equal(items[0].text, "Real task");
  const changed = toggleCheck(body, items[0]);
  assert.match(changed, /- \[x\] Real task/);
  assert.match(changed, /- \[ \] Do not toggle this code/);
  assert.equal(changed.length, body.length);
  assert.equal(toggleCheck(changed, checkItems(changed)[0]), body);
});
test("nested checklists preserve rich text and edit only the marker", () => {
  const body =
    "- [ ] **Parent**\n  - [x] Child with [a link](https://example.com)\n";
  const items = checkItems(body);
  assert.equal(items.length, 2);
  assert.equal(items[0].text, "ParentChild with a link");
  const changed = toggleCheck(body, items[1]);
  assert.equal(
    changed,
    "- [ ] **Parent**\n  - [ ] Child with [a link](https://example.com)\n",
  );
});
