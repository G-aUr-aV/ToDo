import { readStored, writeStored, removeStored } from "./storage";
import { useEffect, useState, useRef } from "react";

import type { Snapshot, Preferences } from "../core/model";
import type { ImportItem, ImportPreview } from "../core/vault";
import { call } from "./client";
import { NotificationPreference } from "./Reminders";
import {
  Banner,
  Button,
  Empty,
  Field,
  Modal,
  download,
  errorMessage,
} from "./components";
type Appearance = {
  theme: string;
  density: string;
  text: string;
  shortcuts: boolean;
  motion: string;
};
const tabs = [
  ["general", "General"],
  ["appearance", "Appearance"],
  ["vault", "Vault & connection"],
  ["recovery", "Recovery"],
  ["data", "Import & export"],
  ["shortcuts", "Shortcuts"],
  ["about", "About & updates"],
];
export function Settings({
  snapshot: s,
  tab,
  setTab,
  appearance,
  setAppearance,
  onSaved,
  onNotice,
  onNavigate,
  onHistory,
  onLogout,
}: {
  snapshot: Snapshot;
  tab: string;
  setTab: (t: string) => void;
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  onSaved: () => void;
  onNotice: (m: string) => void;
  onNavigate: (v: "import" | "diagnostics" | "help") => void;
  onHistory: (id: string) => Promise<void>;
  onLogout: () => void;
}) {
  const [preferences, setPreferences] = useState<Preferences>(s.preferences);
  const preferencesDirty = useRef(false);
  const editPreferences = (value: Preferences) => {
    preferencesDirty.current = true;
    setPreferences(value);
  };
  const [obsidian, setObsidian] = useState(
    () => readStored("todo:obsidian:" + s.vaultKey) ?? "",
  );
  const [password, setPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!preferencesDirty.current) setPreferences(s.preferences);
  }, [s.preferences]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await call("setPreferences", preferences);
      preferencesDirty.current = false;
      onSaved();
      onNotice("Preferences saved.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportMarkdown() {
    setBusy(true);
    try {
      const files = await call<Record<string, string>>("exportNotes");
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const [name, text] of Object.entries(files)) zip.file(name, text);
      download(
        "Todo-task-notes.zip",
        await zip.generateAsync({ type: "blob" }),
      );
      onNotice(
        "Task notes exported. This does not replace a full-vault backup.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const row = (title: string, copy: string, control: React.ReactNode) => (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
      <div className="setting-control">{control}</div>
    </div>
  );
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings categories">
        {tabs.map(([id, title]) => (
          <Button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            kind={tab === id ? "primary" : "ghost"}
            onClick={() => {
              setTab(id);
              setError("");
            }}
          >
            {title}
          </Button>
        ))}
      </nav>
      <section className="settings-content">
        <h2>{tabs.find(([id]) => id === tab)?.[1]}</h2>
        {error && (
          <Banner title="Could not save" kind="danger">
            {error}
          </Banner>
        )}
        {tab === "general" && (
          <>
            {row(
              "Timezone",
              "Date-based views follow this timezone, including midnight.",
              <input
                aria-label="Timezone"
                list="timezones"
                value={preferences.timezone}
                onChange={(e) =>
                  editPreferences({ ...preferences, timezone: e.target.value })
                }
              />,
            )}
            <datalist id="timezones">
              {Intl.supportedValuesOf("timeZone").map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
            {row(
              "Week starts on",
              "Used in planning preferences.",
              <select
                aria-label="Week starts on"
                value={preferences.weekStartsOn}
                onChange={(e) =>
                  editPreferences({
                    ...preferences,
                    weekStartsOn: Number(e.target.value) as 0 | 1,
                  })
                }
              >
                <option value={1}>Monday</option>
                <option value={0}>Sunday</option>
              </select>,
            )}
            {row(
              "Default start page",
              "Choose where Todo opens.",
              <select
                aria-label="Default start page"
                value={preferences.startPage}
                onChange={(e) =>
                  editPreferences({ ...preferences, startPage: e.target.value })
                }
              >
                {["today", "inbox", "upcoming", "all", "projects"].map((v) => (
                  <option key={v} value={v}>
                    {v === "all"
                      ? "All tasks"
                      : v[0].toUpperCase() + v.slice(1)}
                  </option>
                ))}
              </select>,
            )}
            {row(
              "Carry unfinished tasks forward",
              "Move unfinished planned tasks to today automatically. Deadlines stay fixed, and each note retains its first planned date and rollover count.",
              <label className="toggle-label">
                <input
                  type="checkbox"
                  aria-label="Automatic rollover"
                  checked={preferences.autoRollover}
                  onChange={(event) =>
                    editPreferences({
                      ...preferences,
                      autoRollover: event.target.checked,
                    })
                  }
                />
                Enabled
              </label>,
            )}
            {row(
              "New tasks go to",
              "Capture first; decide when it matters later.",
              <span className="read-value">Inbox</span>,
            )}
            <Button disabled={busy} onClick={() => void save()}>
              Save preferences
            </Button>
            <section className="notification-settings">
              <h2>Reminder alerts</h2>
              <NotificationPreference />
            </section>
          </>
        )}
        {tab === "appearance" && (
          <>
            {row(
              "Theme",
              "Choose Light, Dark or your system preference.",
              <select
                aria-label="Theme"
                value={appearance.theme}
                onChange={(e) =>
                  setAppearance({ ...appearance, theme: e.target.value })
                }
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">Use system</option>
              </select>,
            )}
            {row(
              "List density",
              "Keep task rows legible and actions easy to reach.",
              <select
                aria-label="List density"
                value={appearance.density}
                onChange={(e) =>
                  setAppearance({ ...appearance, density: e.target.value })
                }
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>,
            )}
            {row(
              "Text size",
              "Increase text without hiding actions.",
              <select
                aria-label="Text size"
                value={appearance.text}
                onChange={(e) =>
                  setAppearance({ ...appearance, text: e.target.value })
                }
              >
                <option value="default">Default</option>
                <option value="large">Larger</option>
              </select>,
            )}
            {row(
              "Motion",
              "Respect reduced motion preferences.",
              <select
                aria-label="Motion"
                value={appearance.motion}
                onChange={(e) =>
                  setAppearance({ ...appearance, motion: e.target.value })
                }
              >
                <option value="system">Use system</option>
                <option value="reduced">Reduce motion</option>
              </select>,
            )}
            <p className="muted">
              Appearance is saved on this device as you change it.
            </p>
          </>
        )}
        {tab === "vault" && (
          <>
            {row(
              "Workspace vault",
              "Your task notes live in this vault folder on the server.",
              <span className="read-value">{s.vaultName}</span>,
            )}
            {row(
              "Server",
              "The server owns the vault folder. This device does not choose its storage path.",
              <span className="read-value">{location.origin}</span>,
            )}
            {row(
              "Obsidian on this device",
              "Use the name of the matching vault registered in this device’s Obsidian.",
              <input
                aria-label="Obsidian vault name"
                placeholder="Registered vault name"
                value={obsidian}
                onChange={(e) => setObsidian(e.target.value)}
              />,
            )}
            <Button
              kind="secondary"
              onClick={() => {
                writeStored("todo:obsidian:" + s.vaultKey, obsidian.trim());
                onNotice("Obsidian link saved for this device.");
              }}
            >
              Save Obsidian link
            </Button>
            {row(
              "Vault status",
              "Review external notes, duplicate identities and import candidates.",
              <Button
                kind="secondary"
                onClick={() => onNavigate("diagnostics")}
              >
                View diagnostics
              </Button>,
            )}
            <>
              {row(
                "Owner account",
                "Change the initial password and invalidate other signed-in sessions.",
                <Button kind="secondary" onClick={() => setPassword(true)}>
                  Change password
                </Button>,
              )}
              {row(
                "Session",
                "Signing out closes the session and keeps your server task notes.",
                <Button kind="secondary" onClick={onLogout}>
                  Sign out
                </Button>,
              )}
            </>
          </>
        )}
        {tab === "recovery" && (
          <>
            {row(
              "Task versions",
              "The previous note is copied before each edit.",
              <select
                aria-label="Choose a task for recovery"
                value=""
                onChange={(e) =>
                  e.target.value && void onHistory(e.target.value)
                }
              >
                <option value="">Choose task</option>
                {s.tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>,
            )}
            {row(
              "Snapshot retention",
              "Versions are retained; the history view lists the most recent 100 per task.",
              <span className="read-value">Keep all</span>,
            )}
            {row(
              "Full-vault backup",
              "Task versions and exports do not replace a full backup of the vault and recovery folder.",
              <Button kind="secondary" onClick={() => onNavigate("help")}>
                Open guide
              </Button>,
            )}
          </>
        )}
        {tab === "data" && (
          <>
            {row(
              "Import task notes",
              "Preview changes before anything is added.",
              <Button kind="secondary" onClick={() => onNavigate("import")}>
                Choose files
              </Button>,
            )}
            {row(
              "Export task notes",
              "A ZIP of indexed task and project Markdown notes, including completed and trashed tasks.",
              <Button
                kind="secondary"
                disabled={busy}
                onClick={() => void exportMarkdown()}
              >
                Markdown ZIP
              </Button>,
            )}
            {row(
              "Export structured data",
              "A copy for tools and migrations.",
              <Button
                kind="secondary"
                onClick={() =>
                  download(
                    "Todo-tasks.json",
                    JSON.stringify(
                      {
                        schemaVersion: 1,
                        tasks: s.tasks,
                        projects: s.projects,
                      },
                      null,
                      2,
                    ),
                    "application/json",
                  )
                }
              >
                JSON
              </Button>,
            )}
            {row(
              "Manually created notes",
              "Adopt valid task notes without identities through diagnostics.",
              <Button
                kind="secondary"
                onClick={() => onNavigate("diagnostics")}
              >
                Review notes
              </Button>,
            )}
          </>
        )}
        {tab === "shortcuts" && (
          <>
            {row(
              "Single-key shortcuts",
              "N adds a task. Shortcuts pause while typing.",
              <label className="toggle-label">
                <input
                  type="checkbox"
                  aria-label="Single-key shortcuts"
                  checked={appearance.shortcuts}
                  onChange={(e) =>
                    setAppearance({
                      ...appearance,
                      shortcuts: e.target.checked,
                    })
                  }
                />
                {appearance.shortcuts ? "On" : "Off"}
              </label>,
            )}
            {row(
              "Search",
              "Control K on Linux/Windows, Command K on macOS.",
              <span className="read-value">Ctrl / Command K</span>,
            )}
            {row(
              "Keyboard guide",
              "Use Tab to reach controls, Enter to activate and Escape to close dialogs.",
              <Button kind="secondary" onClick={() => onNavigate("help")}>
                View guide
              </Button>,
            )}
            {row(
              "Motion preference",
              "Keep animation comfortable and predictable.",
              <span className="read-value">
                {appearance.motion === "reduced" ? "Reduced" : "Use system"}
              </span>,
            )}
          </>
        )}
        {tab === "about" && (
          <>
            {row(
              "Install as an app",
              "Chrome can open Todo or Mini Today in a separate app window on Mac, Windows and Linux.",
              <Button kind="secondary" onClick={() => onNavigate("help")}>
                Installation guide
              </Button>,
            )}
            {row(
              "Todo",
              "One task experience in your browser or Chrome app window.",
              <span className="read-value">Version {s.version}</span>,
            )}
            {row(
              "Updates",
              "Update the server to receive improvements on every device.",
              <span className="read-value">Manual updates</span>,
            )}
            {row(
              "Help",
              "Learn dates, storage and recovery.",
              <Button kind="secondary" onClick={() => onNavigate("help")}>
                Open guide
              </Button>,
            )}
            {row(
              "Privacy",
              "Your task notes stay on your server. Drafts are kept in this browser’s storage.",
              <span className="read-value">Self-hosted vault</span>,
            )}
          </>
        )}
      </section>
      {password && (
        <PasswordDialog
          onClose={() => setPassword(false)}
          onSaved={() => {
            setPassword(false);
            onNotice("Password changed. Other sessions were signed out.");
          }}
        />
      )}
    </div>
  );
}
function PasswordDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Change owner password" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (newPassword !== confirmation) {
            setError("The new passwords do not match.");
            return;
          }
          setBusy(true);
          try {
            await call("changePassword", { currentPassword, newPassword });
            setCurrent("");
            setNew("");
            setConfirmation("");
            onSaved();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Current password">
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </Field>
        <Field label="New password" hint="Use at least 12 characters.">
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            value={newPassword}
            onChange={(e) => setNew(e.target.value)}
            required
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            required
          />
        </Field>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <Button disabled={busy}>Change password</Button>
      </form>
    </Modal>
  );
}
export function ImportPage({ onImported }: { onImported: () => void }) {
  const [items, setItems] = useState<ImportItem[]>([]);
  const [preview, setPreview] = useState<ImportPreview[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function read(files: FileList | null) {
    if (!files) return;
    setBusy(true);
    setError("");
    try {
      if (
        files.length > 50 ||
        [...files].reduce((n, f) => n + f.size, 0) > 2_000_000
      )
        throw new Error(
          "Choose up to 50 Markdown notes, totaling no more than 2 MB.",
        );
      const values = await Promise.all(
        [...files].map(async (file) => ({
          name: file.name,
          raw: await file.text(),
        })),
      );
      const result = await call<ImportPreview[]>("previewImport", {
        items: values,
      });
      setItems(values);
      setPreview(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const valid = preview.filter((p) => p.valid).length;
  return (
    <div className="import-page">
      <Field label="Task Markdown notes">
        <input
          type="file"
          accept=".md,text/markdown,text/plain"
          multiple
          onChange={(e) => void read(e.target.files)}
        />
      </Field>
      <p className="muted">
        Notes need the task properties from the vault template. Imported files
        receive stable identities when needed; your original files are kept.
      </p>
      {error && (
        <Banner title="Could not import" kind="danger">
          {error}
        </Banner>
      )}
      {preview.length > 0 && (
        <>
          <Banner title={`Review ${preview.length} notes`}>
            {valid} ready. {preview.length - valid} will be skipped. Nothing is
            imported until you confirm.
          </Banner>
          {preview.map((p, i) => (
            <div className="import-row" key={i}>
              <input
                type="checkbox"
                aria-label={"Import " + p.title}
                checked={p.valid}
                disabled={
                  busy || (!p.valid && p.message !== "Ready — task note")
                }
                onChange={() =>
                  setPreview((old) =>
                    old.map((v, n) =>
                      n === i ? { ...v, valid: !v.valid } : v,
                    ),
                  )
                }
              />
              <div>
                <strong>{p.title}</strong>
                <p className={p.valid ? "muted" : "warning-text"}>
                  {p.message}
                </p>
              </div>
            </div>
          ))}
          <Button
            disabled={!valid || busy}
            onClick={() => {
              setBusy(true);
              void call("importNotes", {
                items: items.filter((_, i) => preview[i].valid),
              })
                .then((result) => {
                  const r = result as { skipped: ImportPreview[] };
                  if (r.skipped.length) {
                    setError(
                      "Some notes changed or became duplicates. Review the preview again.",
                    );
                    return;
                  }
                  onImported();
                })
                .catch((e) => setError(errorMessage(e)))
                .finally(() => setBusy(false));
            }}
          >
            Import {valid} selected notes
          </Button>
        </>
      )}
      {!preview.length && (
        <Empty title="Bring task notes into Todo." icon="upload">
          Choose Markdown task notes to review their titles and identities
          before importing.
        </Empty>
      )}
    </div>
  );
}
