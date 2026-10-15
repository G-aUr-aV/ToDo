import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
type Node = {
  type: string;
  value?: string;
  checked?: boolean | null;
  position?: { start: { offset?: number }; end: { offset?: number } };
  children?: Node[];
};
export type CheckItem = {
  offset: number;
  markOffset: number;
  checked: boolean;
  text: string;
};
export function checkItems(body: string): CheckItem[] {
  const root = unified().use(remarkParse).use(remarkGfm).parse(body) as Node;
  const items: CheckItem[] = [];
  const text = (node: Node): string =>
    node.value ?? node.children?.map(text).join("") ?? "";
  const walk = (node: Node) => {
    if (
      node.type === "listItem" &&
      typeof node.checked === "boolean" &&
      node.position?.start.offset !== undefined
    ) {
      const offset = node.position.start.offset;
      const prefix = body.slice(offset, node.position.end.offset);
      const marker = prefix.match(/^(?:[-*+]\s+|\d+[.)]\s+)\[([ xX])\]/);
      if (marker) {
        const markOffset = offset + marker[0].lastIndexOf("[") + 1;
        items.push({
          offset,
          markOffset,
          checked: node.checked,
          text: text(node),
        });
      }
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return items;
}
export function toggleCheck(body: string, item: CheckItem) {
  return (
    body.slice(0, item.markOffset) +
    (item.checked ? " " : "x") +
    body.slice(item.markOffset + 1)
  );
}
