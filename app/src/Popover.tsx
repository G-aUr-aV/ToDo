import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./components";

/** A small menu anchored to a button. Esc, outside clicks and Tab close it. */
export function Popover({
  anchor,
  onClose,
  children,
  label,
  width,
}: {
  anchor: HTMLElement;
  onClose: () => void;
  children: ReactNode;
  label: string;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean }>();
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const box = ref.current!.getBoundingClientRect();
      const up = r.bottom + box.height + 12 > innerHeight && r.top > box.height + 12;
      setPos({
        left: Math.max(8, Math.min(r.left, innerWidth - box.width - 8)),
        top: up ? r.top - box.height - 6 : r.bottom + 6,
        up,
      });
    };
    place();
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    return () => {
      removeEventListener("resize", place);
      removeEventListener("scroll", place, true);
    };
  }, [anchor]);
  useEffect(() => {
    const items = () => [
      ...ref.current!.querySelectorAll<HTMLElement>(
        "[role=menuitem]:not([disabled]),input,button:not([disabled])",
      ),
    ];
    const node = ref.current!;
    (
      node.querySelector<HTMLElement>("[autofocus]") ??
      node.querySelector<HTMLElement>("[role=menuitem].active") ??
      node.querySelector<HTMLElement>("[role=menuitem]") ??
      items()[0]
    )?.focus();
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node))
        close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        anchor.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const list = items().filter((n) => n.getAttribute("role") === "menuitem");
        if (!list.length) return;
        e.preventDefault();
        const i = list.indexOf(document.activeElement as HTMLElement);
        list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length].focus();
      } else if (e.key === "Tab") close.current();
    };
    document.addEventListener("mousedown", down);
    node.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      node.removeEventListener("keydown", key);
      // After a pick, give focus back to the button so Esc and shortcuts act there.
      const active = document.activeElement;
      if ((!active || active === document.body || node.contains(active)) && anchor.isConnected)
        anchor.focus({ preventScroll: true });
    };
  }, [anchor]);
  return createPortal(
    <div
      ref={ref}
      className={"popover" + (pos?.up ? " up" : "")}
      role="menu"
      aria-label={label}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function MenuItem({
  icon,
  children,
  hint,
  onSelect,
  danger,
  active,
  swatch,
}: {
  icon?: string;
  children: ReactNode;
  hint?: string;
  onSelect: () => void;
  danger?: boolean;
  active?: boolean;
  swatch?: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={"menu-item" + (danger ? " danger" : "") + (active ? " active" : "")}
      onClick={onSelect}
    >
      {swatch ? (
        <span className="swatch" style={{ background: swatch }} />
      ) : icon ? (
        <Icon name={icon} />
      ) : null}
      <span className="menu-label">{children}</span>
      {hint && <kbd>{hint}</kbd>}
      {active && <Icon name="check" tone="brand" />}
    </button>
  );
}
