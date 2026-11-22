import test from "node:test";
import assert from "node:assert/strict";
import { titleParts } from "../src/rich-title-parts";

test("URLs become short link labels", () => {
  assert.deepEqual(
    titleParts(
      "Review PR https://git.example.test/projects/APP/repos/x/pull-requests/218/overview",
      "",
    ),
    [
      { kind: "text", text: "Review PR " },
      {
        kind: "url",
        href: "https://git.example.test/projects/APP/repos/x/pull-requests/218/overview",
        label: "git › 218/overview",
      },
    ],
  );
});

test("trailing punctuation stays outside a link", () => {
  assert.deepEqual(titleParts("see https://x.test/a/b).", ""), [
    { kind: "text", text: "see " },
    { kind: "url", href: "https://x.test/a/b", label: "x › a/b" },
    { kind: "text", text: ")." },
  ]);
});

test("issue keys link through the template; technical terms do not", () => {
  assert.deepEqual(
    titleParts("Fix APP-1234 and UTF-8 for SHA-256", "https://j.test/browse/{key}"),
    [
      { kind: "text", text: "Fix " },
      { kind: "key", key: "APP-1234", href: "https://j.test/browse/APP-1234" },
      { kind: "text", text: " and UTF-8 for SHA-256" },
    ],
  );
  assert.deepEqual(titleParts("APP-1234", ""), [
    { kind: "key", key: "APP-1234", href: null },
  ]);
});

test("a bare host link and plain text are handled", () => {
  assert.deepEqual(titleParts("https://slack.test/", ""), [
    { kind: "url", href: "https://slack.test/", label: "slack" },
  ]);
  assert.deepEqual(titleParts("Just words", ""), [
    { kind: "text", text: "Just words" },
  ]);
});
