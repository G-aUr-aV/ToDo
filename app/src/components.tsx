import {
  useEffect,
  useRef,
  useId,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { icons } from "./icons";
export const modifierKey = () => (/Mac/.test(navigator.platform) ? "⌘" : "Ctrl");

export function Icon({
  name,
  size = 16,
  tone = "",
}: {
  name: string;
  size?: number;
  tone?: string;
}) {
  return (
    <svg
      className={"icon " + tone}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: icons[name] ?? icons.circle }}
    />
  );
}
export function Button({
  children,
  kind = "primary",
  icon,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: "primary" | "secondary" | "ghost" | "danger";
  icon?: string;
}) {
  return (
    <button {...props} className={`button ${kind} ${props.className ?? ""}`}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}
export function Banner({
  title,
  children,
  kind = "warning",
}: {
  title: string;
  children?: ReactNode;
  kind?: "warning" | "success" | "danger";
}) {
  return (
    <div
      className={"banner " + kind}
      role={kind === "danger" ? "alert" : "status"}
    >
      <Icon
        name={kind === "success" ? "circle-check" : "alert-triangle"}
        tone={kind === "success" ? "brand" : kind}
        size={16}
      />
      <div>
        <strong>{title}</strong>
        {children && <div className="banner-copy">{children}</div>}
      </div>
    </div>
  );
}
// A quiet line drawing that draws itself in: a sun resting over a horizon.
function EmptyArt() {
  return (
    <svg className="art icon" viewBox="0 0 132 96" aria-hidden="true">
      <path d="M10 76c20-3 34-20 56-20s36 17 56 20" />
      <path d="M26 86h80" />
      <circle cx="66" cy="38" r="13" />
      <path d="M66 13v6M40 38h6M86 38h6M47.6 19.6l4.2 4.2M84.4 19.6l-4.2 4.2" />
    </svg>
  );
}
export function Empty({
  title,
  children,
  action,
  icon,
}: {
  title: string;
  children: ReactNode;
  icon?: string;
  action?: ReactNode;
}) {
  if (icon)
    return (
      <div className="list-empty">
        <span className="list-empty-icon"><Icon name={icon} size={19} /></span>
        <div>
          <h2>{title}</h2>
          <p>{children}</p>
        </div>
        {action}
      </div>
    );
  return (
    <div className="empty">
      <EmptyArt />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const content =
    isValidElement(children) && typeof children.type === "string"
      ? cloneElement(children as ReactElement<{ "aria-label"?: string }>, {
          "aria-label":
            (children.props as { "aria-label"?: string })["aria-label"] ??
            label,
        })
      : children;
  return (
    <label className="field">
      <span>{label}</span>
      {content}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  closeDisabled = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  closeDisabled?: boolean;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = returnFocus.current;
    const dialog = ref.current!;
    const sync = () => {
      const dialogs = [
        ...document.querySelectorAll<HTMLElement>("[role=dialog]"),
      ];
      dialogs.forEach(
        (node, index) => (node.inert = index !== dialogs.length - 1),
      );
      const root = document.getElementById("root");
      if (root) root.inert = dialogs.length > 0;
    };
    sync();
    const first =
      dialog.querySelector<HTMLElement>(
        "input:not([disabled]),textarea:not([disabled]),select:not([disabled])",
      ) ??
      dialog.querySelector<HTMLElement>(
        ".date-shortcuts button,.action-menu button,.modal-actions button",
      ) ??
      dialog.querySelector<HTMLElement>("button:not([disabled])");
    (first ?? dialog).focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key === "Tab") {
        const nodes = [
          ...dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]',
          ),
        ].filter((n) => n.offsetParent !== null);
        const first = nodes[0],
          last = nodes.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    dialog.addEventListener("keydown", key);
    return () => {
      dialog.removeEventListener("keydown", key);
      queueMicrotask(() => {
        sync();
        if (before?.isConnected && before !== document.body) before.focus();
        else document.querySelector<HTMLElement>("#main h1")?.focus();
      });
    };
  }, []);
  return createPortal(
    <div
      className="scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            disabled={closeDisabled}
            onClick={onClose}
          >
            <Icon name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function download(
  name: string,
  content: Blob | string,
  type = "text/plain",
) {
  const blob =
    typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
/** Copy text, falling back to a hidden text box where the Clipboard API is blocked. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    if (!ok) throw new Error("Copying isn't available in this browser.");
  }
}
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "This action could not be completed. Try again.";
}
export function useNarrow() {
  const [value, set] = useMedia("(max-width: 720px)");
  return value;
}
import { useState } from "react";
function useMedia(query: string) {
  const [value, setValue] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const media = matchMedia(query);
    const change = () => setValue(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [query]);
  return [value, setValue] as const;
}
