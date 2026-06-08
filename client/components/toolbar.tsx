import type { EditorView } from "@codemirror/view";

interface ToolbarProps {
  editorView: EditorView;
  readOnly?: boolean;
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

export function Toolbar({ editorView, readOnly }: ToolbarProps) {
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
      title: "Share / export",
      action: () => {},
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
