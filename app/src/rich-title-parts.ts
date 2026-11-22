// Split a task title into text, short link labels and issue keys.
export type Part =
  | { kind: "text"; text: string }
  | { kind: "url"; href: string; label: string }
  | { kind: "key"; key: string; href: string | null };

// Engineering shorthand that looks like an issue key but never is one.
const notKeys = new Set(
  "UTF SHA ISO RFC GPT MD AES TLS HTTP IPV CVE ES".split(" "),
);
const pattern =
  /(https?:\/\/[^\s<>"]+)|\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/g;

function label(href: string) {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, "").split(".")[0];
    const tail = url.pathname.split("/").filter(Boolean).slice(-2).join("/");
    return tail ? `${host} › ${decodeURIComponent(tail)}` : host;
  } catch {
    return href;
  }
}

export function titleParts(text: string, template: string): Part[] {
  const parts: Part[] = [];
  const push = (value: string) => {
    if (!value) return;
    const last = parts.at(-1);
    if (last?.kind === "text") last.text += value;
    else parts.push({ kind: "text", text: value });
  };
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    push(text.slice(at, match.index));
    at = match.index! + match[0].length;
    if (match[1]) {
      const trail = /[.,;:!?)\]}'"]+$/.exec(match[1])?.[0] ?? "";
      const href = match[1].slice(0, match[1].length - trail.length);
      parts.push({ kind: "url", href, label: label(href) });
      push(trail);
    } else if (notKeys.has(match[2])) push(match[0]);
    else
      parts.push({
        kind: "key",
        key: match[0],
        href: template ? template.replace("{key}", match[0]) : null,
      });
  }
  push(text.slice(at));
  return parts;
}
