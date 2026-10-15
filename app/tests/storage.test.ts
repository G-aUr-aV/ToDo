import test from "node:test";
import assert from "node:assert/strict";
import { removeSavedDraft } from "../src/storage";

test("a completed old save cannot remove a newer editor's draft", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      removeItem: (key: string) => entries.delete(key),
    },
  });
  try {
    const submitted = { title: "Plan", notes: "Version A" };
    const newer = { title: "Plan", notes: "Version B" };
    entries.set(
      "draft",
      JSON.stringify({ draft: newer, revision: "old-base" }),
    );
    removeSavedDraft("draft", JSON.stringify(submitted));
    assert.deepEqual(JSON.parse(entries.get("draft")!).draft, newer);
    removeSavedDraft("draft", JSON.stringify(newer));
    assert.equal(entries.has("draft"), false);
    entries.set("draft", "unreadable but potentially recoverable");
    removeSavedDraft("draft", JSON.stringify(submitted));
    assert.equal(entries.has("draft"), true);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
