import { readStored, writeStored } from "./storage";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Snapshot, Preferences } from "../core/model";
import type { ImportItem, ImportPreview } from "../core/vault";
import { call } from "./client";
import { NotificationPreference } from "./Reminders";
import { Banner, Button, Empty, Field, Icon, Modal, copyText, download, errorMessage } from "./components";
type Appearance = {
  theme: string;
  density: string;
  text: string;
  shortcuts: boolean;
  motion: string;
};
type TokenInfo = { id: string; name: string; createdAt: string; lastUsedAt: string | null };
type Created = { token: string; info: TokenInfo; endpoint: string };

function Section({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
      <div className="settings-card">{children}</div>
    </section>
  );
}
function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <strong>{label}</strong>
        {hint && <p>{hint}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
function Segmented({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
function CopyField({ label, value, onCopied }: { label: string; value: string; onCopied: () => void }) {
  return (
    <div className="copy-field">
      <span className="copy-label">{label}</span>
      <code>{value}</code>
      <button
        type="button"
        className="icon-button"
        aria-label={"Copy " + label.toLowerCase()}
        onClick={() =>
          void copyText(value).then(onCopied, () => undefined)
        }
      >
        <Icon name="copy" />
      </button>
    </div>
  );
}
// Ready-to-paste setup for common MCP clients. Every client uses the same
// endpoint and a Bearer token; only the config format differs.
type AgentId = "claude" | "codex" | "cursor" | "other";
const agents: { id: AgentId; name: string }[] = [
  { id: "claude", name: "Claude Code" },
  { id: "codex", name: "Codex" },
  { id: "cursor", name: "Cursor" },
  { id: "other", name: "Other" },
];
function agentSetup(agent: AgentId, { endpoint, token }: Created) {
  const json = (server: object) => JSON.stringify({ mcpServers: { todo: server } }, null, 2);
  switch (agent) {
    case "claude":
      return {
        hint: "Run once in a terminal. It adds Todo to Claude Code for every project.",
        fields: [["Command", `claude mcp add --scope user --transport http todo ${endpoint} --header "Authorization: Bearer ${token}"`]],
      };
    case "codex":
      return {
        hint: "Add the block to ~/.codex/config.toml and the export line to your shell profile.",
        fields: [
          ["config.toml", `[mcp_servers.todo]\nurl = "${endpoint}"\nbearer_token_env_var = "TODO_TOKEN"`],
          ["Shell profile", `export TODO_TOKEN="${token}"`],
        ],
      };
    case "cursor":
      return {
        hint: "Merge into ~/.cursor/mcp.json (global) or .cursor/mcp.json in a project.",
        fields: [["mcp.json", json({ url: endpoint, headers: { Authorization: `Bearer ${token}` } })]],
      };
    default:
      return {
        hint: "Any MCP client with HTTP (Streamable HTTP) support: use the endpoint and send the token as an Authorization: Bearer header. Clients that only run local programs can use the mcp-remote bridge.",
        fields: [
          ["Endpoint", endpoint],
          ["Header", `Authorization: Bearer ${token}`],
          ["Bridge", json({ command: "npx", args: ["mcp-remote", endpoint, "--header", `Authorization: Bearer ${token}`] })],
        ],
      };
  }
}
const ago = (iso: string | null) => {
  if (!iso) return "never used";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 2) return "used just now";
  if (minutes < 60) return `used ${minutes} min ago`;
  if (minutes < 48 * 60) return `used ${Math.round(minutes / 60)} h ago`;
  return `used ${Math.round(minutes / 1440)} days ago`;
};

export function Settings({
  snapshot: s,
  appearance,
  setAppearance,
  onSaved,
  onNotice,
  onNavigate,
  onHistory,
  onLogout,
}: {
  snapshot: Snapshot;
  appearance: Appearance;
  setAppearance: (a: Appearance) => void;
  onSaved: () => void;
  onNotice: (m: string) => void;
  onNavigate: (v: "import" | "diagnostics" | "archived") => void;
  onHistory: (id: string) => Promise<void>;
  onLogout: () => void;
}) {
  const [preferences, setPreferences] = useState<Preferences>(s.preferences);
  const [prefError, setPrefError] = useState("");
  const dirty = useRef(false);
  const [obsidian, setObsidian] = useState(() => readStored("todo:obsidian:" + s.vaultKey) ?? "");
  const [password, setPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [created, setCreated] = useState<Created | null>(null);
  const [tokenName, setTokenName] = useState("Claude Code");
  const [agent, setAgent] = useState<AgentId>("claude");
  useEffect(() => {
    if (!dirty.current) setPreferences(s.preferences);
  }, [s.preferences]);
  useEffect(() => {
    void call<TokenInfo[]>("listTokens").then(setTokens, () => undefined);
  }, []);
  // A half-typed issue link keeps its last saved value so other settings still save.
  const linkValid = (v: string) => v === "" || (/^https?:\/\//.test(v) && v.includes("{key}"));
  const savePreferences = (value: Preferences) =>
    call("setPreferences", {
      ...value,
      issueLinkTemplate: linkValid(value.issueLinkTemplate.trim())
        ? value.issueLinkTemplate.trim()
        : s.preferences.issueLinkTemplate,
    });
  const latest = useRef(preferences);
  latest.current = preferences;
  // Preferences save themselves shortly after a change, and on leaving the page.
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => {
      void savePreferences(preferences)
        .then(() => {
          dirty.current = false;
          setPrefError("");
          onSaved();
          onNotice("Settings saved");
        })
        .catch((e) => setPrefError(errorMessage(e)));
    }, 700);
    return () => clearTimeout(timer);
  }, [preferences]);
  useEffect(
    () => () => {
      if (dirty.current)
        void savePreferences(latest.current).then(onSaved, () => undefined);
    },
    [],
  );
  const edit = (patch: Partial<Preferences>) => {
    dirty.current = true;
    setPreferences((p) => ({ ...p, ...patch }));
  };
  async function createToken() {
    setBusy(true);
    try {
      const result = await call<Created>("createToken", { name: tokenName.trim() || "Agent" });
      setCreated(result);
      setTokens(await call<TokenInfo[]>("listTokens"));
    } catch (e) {
      onNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    try {
      await call("revokeToken", { id });
      setTokens((t) => t.filter((x) => x.id !== id));
      if (created?.info.id === id) setCreated(null);
      onNotice("Agent disconnected");
    } catch (e) {
      onNotice(errorMessage(e));
    }
  }
  async function exportMarkdown() {
    setBusy(true);
    try {
      const files = await call<Record<string, string>>("exportNotes");
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (const [name, text] of Object.entries(files)) zip.file(name, text);
      download("Todo-task-notes.zip", await zip.generateAsync({ type: "blob" }));
      onNotice("Task notes exported");
    } catch (e) {
      onNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const setup = created ? agentSetup(agent, created) : null;
  return (
    <div className="settings">
      <Section
        title="Connect an agent"
        lead="Let Claude Code, Codex, Cursor or any MCP client find, update and close tasks. Use one token per agent; each is shown once."
      >
        {created ? (
          <div className="token-created">
            <Banner title="Connect your agent now" kind="success">
              Copy what you need before leaving: the token isn't shown again.
            </Banner>
            <Segmented
              label="Agent"
              value={agent}
              options={agents.map((a) => [a.id, a.name])}
              onChange={(v) => setAgent(v as AgentId)}
            />
            <p className="setup-hint">{setup!.hint}</p>
            {setup!.fields.map(([label, value]) => (
              <CopyField key={label} label={label} value={value} onCopied={() => onNotice(label + " copied")} />
            ))}
            {agent !== "other" && (
              <CopyField label="Token" value={created.token} onCopied={() => onNotice("Token copied")} />
            )}
            <Button kind="ghost" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        ) : (
          <form
            className="token-form"
            onSubmit={(e) => {
              e.preventDefault();
              void createToken();
            }}
          >
            <input
              aria-label="Agent name"
              value={tokenName}
              maxLength={60}
              onChange={(e) => setTokenName(e.target.value)}
            />
            <Button icon="key" disabled={busy}>
              Create token
            </Button>
          </form>
        )}
        {tokens.map((t) => (
          <div className="token-row" key={t.id}>
            <Icon name="key" tone="muted" />
            <strong>{t.name}</strong>
            <span className="muted">
              {new Date(t.createdAt).toLocaleDateString()} · {ago(t.lastUsedAt)}
            </span>
            <Button kind="ghost" onClick={() => void revoke(t.id)}>
              Revoke
            </Button>
          </div>
        ))}
      </Section>
      {prefError && (
        <Banner title="Could not save settings" kind="danger">
          {prefError}
        </Banner>
      )}
      <Section title="Issue links" lead="Keys like APP-1234 in task names open in your tracker.">
        <Row
          label="Link address"
          hint={
            linkValid(preferences.issueLinkTemplate.trim())
              ? "Use {key} where the issue key goes."
              : "Not saved yet: start with https:// and include {key}."
          }
        >
          <input
            aria-label="Issue link address"
            placeholder="https://yourcompany.atlassian.net/browse/{key}"
            value={preferences.issueLinkTemplate}
            onChange={(e) => edit({ issueLinkTemplate: e.target.value })}
          />
        </Row>
      </Section>
      <Section title="Planning">
        <Row label="Open on" hint="The page Todo shows when it starts.">
          <Segmented
            label="Open on"
            value={preferences.startPage}
            options={[
              ["tasks", "Tasks"],
              ["done", "Done"],
            ]}
            onChange={(v) => edit({ startPage: v as Preferences["startPage"] })}
          />
        </Row>
        <Row label="Carry unfinished tasks forward" hint="Past plan dates move to today. Deadlines stay fixed.">
          <label className="switch">
            <input
              type="checkbox"
              aria-label="Carry unfinished tasks forward"
              checked={preferences.autoRollover}
              onChange={(e) => edit({ autoRollover: e.target.checked })}
            />
            <span />
          </label>
        </Row>
        <Row label="Timezone" hint="Days, Done groups and midnight follow this.">
          <input
            aria-label="Timezone"
            list="timezones"
            value={preferences.timezone}
            onChange={(e) => edit({ timezone: e.target.value })}
          />
          <datalist id="timezones">
            {Intl.supportedValuesOf("timeZone").map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </Row>
        <Row label="Week starts on">
          <Segmented
            label="Week starts on"
            value={String(preferences.weekStartsOn)}
            options={[
              ["1", "Monday"],
              ["0", "Sunday"],
            ]}
            onChange={(v) => edit({ weekStartsOn: Number(v) as 0 | 1 })}
          />
        </Row>
      </Section>
      <Section title="Appearance" lead="Saved on this device.">
        <Row label="Theme">
          <Segmented
            label="Theme"
            value={appearance.theme}
            options={[
              ["light", "Light"],
              ["dark", "Dark"],
              ["system", "System"],
            ]}
            onChange={(theme) => setAppearance({ ...appearance, theme })}
          />
        </Row>
        <Row label="Text size">
          <Segmented
            label="Text size"
            value={appearance.text}
            options={[
              ["default", "Default"],
              ["large", "Larger"],
            ]}
            onChange={(text) => setAppearance({ ...appearance, text })}
          />
        </Row>
        <Row label="Motion">
          <Segmented
            label="Motion"
            value={appearance.motion}
            options={[
              ["system", "System"],
              ["reduced", "Reduced"],
            ]}
            onChange={(motion) => setAppearance({ ...appearance, motion })}
          />
        </Row>
        <Row label="Single-key shortcuts" hint="N, J/K, X, C, E. They pause while you type.">
          <label className="switch">
            <input
              type="checkbox"
              aria-label="Single-key shortcuts"
              checked={appearance.shortcuts}
              onChange={(e) => setAppearance({ ...appearance, shortcuts: e.target.checked })}
            />
            <span />
          </label>
        </Row>
      </Section>
      <Section title="Reminders">
        <div className="setting-row">
          <NotificationPreference />
        </div>
      </Section>
      <Section title="Vault & Obsidian">
        <Row label="Vault" hint="Task notes live in this folder on the server.">
          <span className="read-value">{s.vaultName}</span>
        </Row>
        <Row label="Obsidian on this device" hint="The vault's name in this device's Obsidian.">
          <input
            aria-label="Obsidian vault name"
            placeholder="Registered vault name"
            value={obsidian}
            onChange={(e) => setObsidian(e.target.value)}
            onBlur={() => {
              writeStored("todo:obsidian:" + s.vaultKey, obsidian.trim());
            }}
          />
        </Row>
        <Row label="Vault status" hint="Notes Todo can't read, duplicates and notes to adopt.">
          <Button kind="secondary" onClick={() => onNavigate("diagnostics")}>
            Review
          </Button>
        </Row>
      </Section>
      <Section title="Data">
        <Row label="Import task notes" hint="Preview before anything is added.">
          <Button kind="secondary" icon="upload" onClick={() => onNavigate("import")}>
            Choose files
          </Button>
        </Row>
        <Row label="Export" hint="Doesn't replace a full backup of the vault and state folders.">
          <span className="button-pair">
            <Button kind="secondary" icon="download" disabled={busy} onClick={() => void exportMarkdown()}>
              Markdown
            </Button>
            <Button
              kind="secondary"
              onClick={() =>
                download(
                  "Todo-tasks.json",
                  JSON.stringify({ schemaVersion: 1, tasks: s.tasks, projects: s.projects }, null, 2),
                  "application/json",
                )
              }
            >
              JSON
            </Button>
          </span>
        </Row>
        <Row label="Earlier versions" hint="Todo keeps the previous note before each edit.">
          <select
            aria-label="Choose a task to see earlier versions"
            value=""
            onChange={(e) => e.target.value && void onHistory(e.target.value)}
          >
            <option value="">Choose a task</option>
            {s.tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Archived projects">
          <Button kind="secondary" icon="archive" onClick={() => onNavigate("archived")}>
            Open
          </Button>
        </Row>
      </Section>
      <Section title="Account">
        <Row label="Password" hint="Changing it signs out other devices and disconnects agents.">
          <Button kind="secondary" icon="lock" onClick={() => setPassword(true)}>
            Change
          </Button>
        </Row>
        <Row label="Sign out" hint={`Version ${s.version}. You stay signed in for a week on each device.`}>
          <Button kind="secondary" onClick={onLogout}>
            Sign out
          </Button>
        </Row>
      </Section>
      {password && (
        <PasswordDialog
          onClose={() => setPassword(false)}
          onSaved={() => {
            setPassword(false);
            setTokens([]);
            setCreated(null);
            onNotice("Password changed. Other sessions and agents were signed out.");
          }}
        />
      )}
    </div>
  );
}
function PasswordDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Change password" onClose={onClose}>
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
        <Field label="New password" hint="At least 12 characters. Agents will need a new token.">
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
        <div className="modal-actions">
          <Button disabled={busy}>Change password</Button>
        </div>
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
      if (files.length > 50 || [...files].reduce((n, f) => n + f.size, 0) > 2_000_000)
        throw new Error("Choose up to 50 Markdown notes, totaling no more than 2 MB.");
      const values = await Promise.all(
        [...files].map(async (file) => ({ name: file.name, raw: await file.text() })),
      );
      const result = await call<ImportPreview[]>("previewImport", { items: values });
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
        Notes need the task properties from the vault template. Imported files receive stable
        identities when needed; your original files are kept.
      </p>
      {error && (
        <Banner title="Could not import" kind="danger">
          {error}
        </Banner>
      )}
      {preview.length > 0 && (
        <>
          <Banner title={`Review ${preview.length} notes`}>
            {valid} ready. {preview.length - valid} will be skipped. Nothing is imported until you
            confirm.
          </Banner>
          {preview.map((p, i) => (
            <label className="list-row" key={i}>
              <input
                type="checkbox"
                aria-label={"Import " + p.title}
                checked={p.valid}
                disabled={busy || (!p.valid && p.message !== "Ready — task note")}
                onChange={() =>
                  setPreview((old) => old.map((v, n) => (n === i ? { ...v, valid: !v.valid } : v)))
                }
              />
              <span className="list-text">
                <strong>{p.title}</strong>
                <span className={p.valid ? "muted" : "warning-text"}>{p.message}</span>
              </span>
            </label>
          ))}
          <Button
            disabled={!valid || busy}
            onClick={() => {
              setBusy(true);
              void call("importNotes", { items: items.filter((_, i) => preview[i].valid) })
                .then((result) => {
                  const r = result as { skipped: ImportPreview[] };
                  if (r.skipped.length) {
                    setError("Some notes changed or became duplicates. Review the preview again.");
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
        <Empty title="Bring task notes into Todo.">
          Choose Markdown task notes to review their titles and identities before importing.
        </Empty>
      )}
    </div>
  );
}
