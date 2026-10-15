// Browser storage can be unavailable or full. A storage failure must never
// interrupt editing or turn a successful server write into a reported failure.
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeStored(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
export function removeStored(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* The note is already durable. */
  }
}

// An older request can finish after its editor unmounts and a newer editor
// writes a draft at the same key. Only clear the exact content that was saved.
export function removeSavedDraft(key: string, serializedDraft: string): void {
  try {
    const stored = JSON.parse(readStored(key) ?? "null");
    if (stored && JSON.stringify(stored.draft) === serializedDraft)
      removeStored(key);
  } catch {
    /* Preserve an unreadable draft so it can still be recovered. */
  }
}
