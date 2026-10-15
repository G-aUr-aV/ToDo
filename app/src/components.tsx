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
export function Icon({
  name,
  size = 20,
  tone = "muted",
}: {
  name: string;
  size?: number;
  tone?: string;
}) {
  return (
    <img
      className={"icon " + tone}
      src={`${import.meta.env.BASE_URL}icons/${name}.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
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
      {icon && (
        <Icon
          name={icon}
          tone={kind === "primary" || kind === "danger" ? "white" : "brand"}
        />
      )}
      <span>{children}</span>
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
      />
      <div>
        <strong>{title}</strong>
        {children && <div className="banner-copy">{children}</div>}
      </div>
    </div>
  );
}
export function Empty({
  title,
  children,
  icon = "sun",
  action,
}: {
  title: string;
  children: ReactNode;
  icon?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} tone="brand" />
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
