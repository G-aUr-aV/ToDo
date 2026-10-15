import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { checkItems, toggleCheck } from "../core/checklist";
export function MarkdownNote({
  body,
  onChange,
}: {
  body: string;
  onChange: (body: string) => void;
}) {
  const items = checkItems(body);
  return (
    <div className="markdown-note">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          input: () => null,
          li: ({ node, children, ...props }) => {
            const item = items.find(
              (i) => i.offset === node?.position?.start.offset,
            );
            return item ? (
              <li className="task-list-item">
                <label className="checklist-row">
                  <span className="checkbox-target">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      aria-label={item.text}
                      onChange={() => onChange(toggleCheck(body, item))}
                    />
                  </span>
                  <span>{children}</span>
                </label>
              </li>
            ) : (
              <li {...props}>{children}</li>
            );
          },
          a: ({ href, children }) =>
            href?.startsWith("https://") ? (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          img: ({ alt }) => (
            <span className="muted">
              {alt ? `Image: ${alt}` : "Image in the note"} — open in Obsidian
              to view
            </span>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
