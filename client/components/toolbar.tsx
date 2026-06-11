import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { lezerToParseTree } from "../markdown_parser/parse_tree.ts";
import { renderMarkdownToHtml } from "../markdown_renderer/markdown_render.ts";

interface ToolbarProps {
  editorView: EditorView;
  readOnly?: boolean;
  fileName?: string;
}

// Download the current editor contents as a .md file.
function downloadMarkdown(view: EditorView, fileName?: string) {
  const markdown = view.state.doc.toString();
  const base = (fileName && fileName.trim()) ? fileName.trim() : "document";
  // Use the last path segment and ensure a .md extension.
  const leaf = base.split("/").pop() || base;
  const name = leaf.endsWith(".md") ? leaf : `${leaf}.md`;
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Render the current page to HTML and open the browser print dialog, where the
// user can "Save as PDF". Reuses the editor's own parse tree so custom syntax
// renders the same way it does on screen.
function exportPdf(view: EditorView, fileName?: string) {
  const text = view.state.doc.toString();
  const tree = lezerToParseTree(text, syntaxTree(view.state).topNode);
  const bodyHtml = renderMarkdownToHtml(tree);
  const base = (fileName && fileName.trim()) ? fileName.trim() : "document";
  const title = (base.split("/").pop() || base).replace(/</g, "&lt;");

  const printCss = `
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#111;max-width:760px;margin:24px auto;padding:0 16px;}
    h1,h2,h3,h4{line-height:1.25;margin-top:1.2em;}
    table{border-collapse:collapse;width:100%;margin:1em 0;}
    th,td{border:1px solid #ccc;padding:6px 10px;text-align:left;}
    code{background:#f3f3f3;padding:.1em .3em;border-radius:3px;font-family:ui-monospace,Menlo,Consolas,monospace;}
    pre{background:#f6f6f6;padding:12px;border-radius:6px;overflow:auto;}
    pre code{background:none;padding:0;}
    blockquote{border-left:3px solid #ccc;margin:0;padding-left:12px;color:#555;}
    img{max-width:100%;}
    a{color:#0645ad;text-decoration:none;}
    @page{margin:18mm;}`;

  const win = globalThis.open("", "_blank");
  if (!win) {
    alert("Couldn't open the print window — please allow pop-ups for this site.");
    return;
  }
  win.document.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>` +
      `<style>${printCss}</style></head><body>${bodyHtml}</body></html>`,
  );
  win.document.close();
  win.focus();
  // Give the new document a tick to lay out before invoking print.
  setTimeout(() => win.print(), 300);
}

type ToolbarItem =
  | { kind: "btn"; icon: string; title: string; action: () => void }
  | { kind: "sep" };

function wrapOrInsert(
  view: EditorView,
  before: string,
  after: string,
  placeholder: string,
) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const text = selected || placeholder;
  view.dispatch({
    changes: { from, to, insert: `${before}${text}${after}` },
    selection: {
      anchor: from + before.length,
      head: from + before.length + text.length,
    },
  });
  view.focus();
}

function insertAtLineStart(view: EditorView, prefix: string) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  view.dispatch({
    changes: { from: line.from, to: line.from, insert: prefix },
    selection: { anchor: line.from + prefix.length + (from - line.from) },
  });
  view.focus();
}

export function Toolbar({ editorView, readOnly, fileName }: ToolbarProps) {
  if (readOnly) return null;

  const items: ToolbarItem[] = [
    {
      kind: "btn",
      icon: "bold",
      title: "Bold",
      action: () => wrapOrInsert(editorView, "**", "**", "bold"),
    },
    {
      kind: "btn",
      icon: "italic",
      title: "Italic",
      action: () => wrapOrInsert(editorView, "_", "_", "italic"),
    },
    {
      kind: "btn",
      icon: "heading",
      title: "Heading",
      action: () => insertAtLineStart(editorView, "## "),
    },
    { kind: "sep" },
    {
      kind: "btn",
      icon: "list",
      title: "Bullet list",
      action: () => insertAtLineStart(editorView, "- "),
    },
    {
      kind: "btn",
      icon: "list-check",
      title: "Task",
      action: () => insertAtLineStart(editorView, "- [ ] "),
    },
    { kind: "sep" },
    {
      kind: "btn",
      icon: "link",
      title: "Link",
      action: () => wrapOrInsert(editorView, "[", "]()", "link text"),
    },
    {
      kind: "btn",
      icon: "photo",
      title: "Image",
      action: () => wrapOrInsert(editorView, "![", "]()", "alt text"),
    },
    {
      kind: "btn",
      icon: "code",
      title: "Code",
      action: () => wrapOrInsert(editorView, "`", "`", "code"),
    },
    { kind: "sep" },
    {
      kind: "btn",
      icon: "share",
      title: "Download as Markdown",
      action: () => downloadMarkdown(editorView, fileName),
    },
    {
      kind: "btn",
      icon: "file-type-pdf",
      title: "Export as PDF",
      action: () => exportPdf(editorView, fileName),
    },
  ];

  return (
    <div id="sb-toolbar">
      {items.map((item, i) => {
        if (item.kind === "sep") {
          return <div key={`sep-${i}`} className="sb-toolbar-sep" />;
        }
        return (
          <button
            key={item.icon}
            className={`sb-toolbar-btn${
              item.icon === "share" ? " sb-toolbar-share" : ""
            }`}
            title={item.title}
            onClick={item.action}
          >
            <i className={`ti ti-${item.icon}`} />
          </button>
        );
      })}
    </div>
  );
}
