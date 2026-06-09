# Inline comments

Outline-style inline comments: select text → click a floating button → write a
comment → the selection is highlighted and a thread icon appears in the margin.
Click the icon to read the thread, reply, or resolve.

```
 Select a word or sentence in the editor       [💬]  ← floating button on selection
          ↓
 ┌──────────────────────────────────┐
 │ Add a comment…                   │
 │ [____________________________]   │
 │                      [Comment]   │
 └──────────────────────────────────┘
          ↓
 The referenced text [is highlighted] 💬  ← gutter icon in margin
```

---

## Architecture overview

| Concern | Approach |
|---|---|
| Storage | `_comments/PageName.json` — read/written via `space.readFile` / `space.writeFile` |
| Anchor | Selected text snippet (up to 100 chars) — re-located by text search on load |
| Highlighting | CodeMirror `Decoration.mark` with class `sb-comment-highlight` |
| Gutter icon | CodeMirror `Decoration.widget` (inline, right of selection end) |
| Floating button | Positioned DOM element using `view.coordsAtPos()`, shown on non-empty selection |
| Thread UI | Preact component rendered in a floating panel anchored to the gutter icon |
| Multi-user | All users who can read the page can read its `_comments/` file |

---

## Data model

```ts
// plug-api/lib/comments.ts  (new shared types file)

export type CommentReply = {
  id: string;
  author: string;
  createdAt: string;   // ISO 8601
  body: string;
};

export type Comment = {
  id: string;
  anchor: string;         // selected text, up to 100 chars
  anchorContext: string;  // up to 30 chars *before* the selection — disambiguates duplicates
  author: string;
  createdAt: string;
  resolved: boolean;
  thread: CommentReply[];
};

export type PageComments = Comment[];
```

### Storage format

File: `_comments/PageName.json` (slashes in page name become `/`, folder is created on demand).

```json
[
  {
    "id": "c1a2b3",
    "anchor": "the selected text goes here",
    "anchorContext": "text before t",
    "author": "antoine",
    "createdAt": "2026-06-09T14:00:00Z",
    "resolved": false,
    "thread": [
      {
        "id": "r9z8y7",
        "author": "alice",
        "createdAt": "2026-06-09T14:05:00Z",
        "body": "Good point, I'll fix this."
      }
    ]
  }
]
```

The `_` prefix keeps `_comments/` out of the normal page listing. Files inside
are visible to anyone who can read the parent page (same permission prefix).

---

## Part 1 — Comment storage plug

Create `plugs/comments/comments.ts`:

```ts
import { space } from "@silverbulletmd/silverbullet/syscalls";
import type { Comment, PageComments } from "../../plug-api/lib/comments.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function commentsPath(pageName: string): string {
  return `_comments/${pageName}.json`;
}

async function readComments(pageName: string): Promise<PageComments> {
  try {
    const bytes = await space.readFile(commentsPath(pageName));
    return JSON.parse(new TextDecoder().decode(bytes)) as PageComments;
  } catch {
    return [];
  }
}

async function writeComments(
  pageName: string,
  comments: PageComments,
): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(comments, null, 2));
  await space.writeFile(commentsPath(pageName), bytes);
}

// ── Public API (called as plug functions from client) ────────────────────────

export async function getComments(
  pageName: string,
): Promise<PageComments> {
  return readComments(pageName);
}

export async function addComment(
  pageName: string,
  comment: Omit<Comment, "id" | "createdAt" | "resolved" | "thread">,
  author: string,
): Promise<Comment> {
  const comments = await readComments(pageName);
  const newComment: Comment = {
    ...comment,
    id: crypto.randomUUID().slice(0, 8),
    author,
    createdAt: new Date().toISOString(),
    resolved: false,
    thread: [],
  };
  comments.push(newComment);
  await writeComments(pageName, comments);
  return newComment;
}

export async function addReply(
  pageName: string,
  commentId: string,
  body: string,
  author: string,
): Promise<void> {
  const comments = await readComments(pageName);
  const comment = comments.find((c) => c.id === commentId);
  if (!comment) throw new Error(`Comment ${commentId} not found`);
  comment.thread.push({
    id: crypto.randomUUID().slice(0, 8),
    author,
    createdAt: new Date().toISOString(),
    body,
  });
  await writeComments(pageName, comments);
}

export async function resolveComment(
  pageName: string,
  commentId: string,
): Promise<void> {
  const comments = await readComments(pageName);
  const comment = comments.find((c) => c.id === commentId);
  if (comment) comment.resolved = true;
  await writeComments(pageName, comments);
}

export async function deleteComment(
  pageName: string,
  commentId: string,
): Promise<void> {
  const comments = await readComments(pageName);
  const filtered = comments.filter((c) => c.id !== commentId);
  await writeComments(pageName, filtered);
}
```

Create `plugs/comments/index.plug.yaml`:

```yaml
name: comments
imports:
  - "@silverbulletmd/silverbullet/syscalls"

functions:
  getComments:
    path: "./comments.ts:getComments"
  addComment:
    path: "./comments.ts:addComment"
  addReply:
    path: "./comments.ts:addReply"
  resolveComment:
    path: "./comments.ts:resolveComment"
  deleteComment:
    path: "./comments.ts:deleteComment"
```

Register the plug in `plug_manifest.json` (or wherever other plugs are listed).

---

## Part 2 — Shared types

Create `plug-api/lib/comments.ts` with the types from the data model section
above. Both the plug and the client import from here.

---

## Part 3 — CodeMirror comment plugin

Create `client/codemirror/comments.ts`:

```ts
import {
  StateEffect,
  StateField,
  type EditorState,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { Comment } from "../../plug-api/lib/comments.ts";
import type { Client } from "../client.ts";

// ── State effects ──────────────────────────────────────────────────────────────

export const setCommentsEffect = StateEffect.define<Comment[]>();
export const openThreadEffect = StateEffect.define<string | null>(); // commentId

// ── State fields ──────────────────────────────────────────────────────────────

export const commentsField = StateField.define<Comment[]>({
  create: () => [],
  update(comments, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setCommentsEffect)) return effect.value;
    }
    return comments;
  },
});

export const activeThreadField = StateField.define<string | null>({
  create: () => null,
  update(active, tr) {
    for (const effect of tr.effects) {
      if (effect.is(openThreadEffect)) return effect.value;
    }
    return active;
  },
});

// ── Gutter icon widget ─────────────────────────────────────────────────────────

class CommentIconWidget extends WidgetType {
  constructor(
    readonly commentId: string,
    readonly resolved: boolean,
    readonly replyCount: number,
    readonly onClick: (commentId: string) => void,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const btn = document.createElement("button");
    btn.className = `sb-comment-icon${this.resolved ? " resolved" : ""}`;
    btn.title = this.resolved
      ? "Resolved comment"
      : `${this.replyCount + 1} comment${this.replyCount > 0 ? "s" : ""}`;
    btn.innerHTML = this.resolved ? "✓" : "💬";
    if (this.replyCount > 0) {
      const badge = document.createElement("span");
      badge.className = "sb-comment-badge";
      badge.textContent = String(this.replyCount + 1);
      btn.appendChild(badge);
    }
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onClick(this.commentId);
    });
    return btn;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof CommentIconWidget &&
      other.commentId === this.commentId &&
      other.resolved === this.resolved &&
      other.replyCount === this.replyCount
    );
  }
}

// ── Locate anchor in document ─────────────────────────────────────────────────

/**
 * Find the position of `anchor` in `doc`, using `anchorContext` (text before)
 * to pick the right occurrence when the anchor appears multiple times.
 * Returns [from, to] or null if not found.
 */
function locateAnchor(
  state: EditorState,
  anchor: string,
  anchorContext: string,
): [number, number] | null {
  const text = state.doc.toString();
  let searchFrom = 0;
  while (true) {
    const idx = text.indexOf(anchor, searchFrom);
    if (idx === -1) return null;

    // Check context (text immediately before the match)
    if (anchorContext) {
      const before = text.slice(Math.max(0, idx - anchorContext.length), idx);
      if (before.endsWith(anchorContext)) {
        return [idx, idx + anchor.length];
      }
    } else {
      return [idx, idx + anchor.length];
    }
    searchFrom = idx + 1;
  }
}

// ── Decoration builder ────────────────────────────────────────────────────────

function buildDecorations(
  state: EditorState,
  onIconClick: (commentId: string) => void,
): DecorationSet {
  const comments = state.field(commentsField);
  const activeThread = state.field(activeThreadField);
  const widgets: Range<Decoration>[] = [];

  for (const comment of comments) {
    if (comment.resolved) continue;

    const pos = locateAnchor(state, comment.anchor, comment.anchorContext);
    if (!pos) continue;
    const [from, to] = pos;

    // Highlight mark
    widgets.push(
      Decoration.mark({
        class: `sb-comment-highlight${activeThread === comment.id ? " active" : ""}`,
        attributes: { "data-comment-id": comment.id },
      }).range(from, to),
    );

    // Icon widget — placed at the end of the highlighted range
    widgets.push(
      Decoration.widget({
        widget: new CommentIconWidget(
          comment.id,
          comment.resolved,
          comment.thread.length,
          onIconClick,
        ),
        side: 1,
      }).range(to),
    );
  }

  // Sort required by CodeMirror
  widgets.sort((a, b) => a.from - b.from || a.startSide - b.startSide);
  return Decoration.set(widgets, true);
}

// ── Main plugin ───────────────────────────────────────────────────────────────

export function commentsPlugin(
  client: Client,
  onOpenThread: (commentId: string | null) => void,
  onAddComment: (anchor: string, anchorContext: string) => void,
) {
  let floatingBtn: HTMLElement | null = null;

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view.state, onOpenThread);
        floatingBtn = this.createFloatingButton(view);
        view.dom.parentElement?.appendChild(floatingBtn);
      }

      createFloatingButton(view: EditorView): HTMLElement {
        const btn = document.createElement("button");
        btn.className = "sb-comment-add-btn";
        btn.title = "Add comment";
        btn.innerHTML = "💬 Comment";
        btn.style.display = "none";
        btn.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const sel = view.state.selection.main;
          if (sel.empty) return;
          const anchor = view.state.sliceDoc(sel.from, sel.to).slice(0, 100);
          const contextStart = Math.max(0, sel.from - 30);
          const anchorContext = view.state.sliceDoc(contextStart, sel.from);
          onAddComment(anchor, anchorContext);
          btn.style.display = "none";
        });
        return btn;
      }

      update(update: any) {
        if (
          update.docChanged ||
          update.state.field(commentsField) !==
            update.startState.field(commentsField) ||
          update.state.field(activeThreadField) !==
            update.startState.field(activeThreadField)
        ) {
          this.decorations = buildDecorations(
            update.view.state,
            onOpenThread,
          );
        }

        // Position or hide the floating button
        if (floatingBtn) {
          const sel = update.view.state.selection.main;
          if (!sel.empty) {
            try {
              const coords = update.view.coordsAtPos(sel.to);
              if (coords) {
                const editorRect =
                  update.view.dom.getBoundingClientRect();
                floatingBtn.style.display = "block";
                floatingBtn.style.top = `${coords.bottom - editorRect.top + 4}px`;
                floatingBtn.style.left = `${coords.left - editorRect.left}px`;
              }
            } catch {
              floatingBtn.style.display = "none";
            }
          } else {
            floatingBtn.style.display = "none";
          }
        }
      }

      destroy() {
        floatingBtn?.remove();
        floatingBtn = null;
      }
    },
    { decorations: (v) => v.decorations },
  );
}
```

---

## Part 4 — Comment thread panel (Preact)

Create `client/components/comment_thread.tsx`:

```tsx
import { useEffect, useRef, useState } from "preact/hooks";
import type { Comment } from "../../plug-api/lib/comments.ts";

type Props = {
  comment: Comment;
  currentUser: string;
  onReply: (body: string) => Promise<void>;
  onResolve: () => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
  // Pixel coords where the thread should anchor (near the gutter icon)
  anchorTop: number;
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CommentThread(
  { comment, currentUser, onReply, onResolve, onDelete, onClose, anchorTop }: Props,
) {
  const [replyText, setReplyText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [comment.id]);

  const submitReply = async () => {
    const body = replyText.trim();
    if (!body) return;
    setSubmitting(true);
    try {
      await onReply(body);
      setReplyText("");
    } finally {
      setSubmitting(false);
    }
  };

  const allMessages = [
    { author: comment.author, createdAt: comment.createdAt, body: null },
    ...comment.thread.map((r) => ({
      author: r.author,
      createdAt: r.createdAt,
      body: r.body,
    })),
  ];

  return (
    <div
      className="sb-comment-thread"
      style={{ top: `${anchorTop}px` }}
    >
      <div className="sb-comment-thread-header">
        <span className="sb-comment-anchor">"{comment.anchor.slice(0, 40)}{comment.anchor.length > 40 ? "…" : ""}"</span>
        <div className="sb-comment-thread-actions">
          {!comment.resolved && (
            <button
              className="sb-comment-resolve-btn"
              title="Resolve"
              onClick={onResolve}
            >
              ✓ Resolve
            </button>
          )}
          {comment.author === currentUser && (
            <button
              className="sb-comment-delete-btn"
              title="Delete"
              onClick={onDelete}
            >
              🗑
            </button>
          )}
          <button className="sb-comment-close-btn" onClick={onClose}>×</button>
        </div>
      </div>

      <div className="sb-comment-messages">
        {allMessages.map((msg, i) => (
          <div key={i} className="sb-comment-message">
            <div className="sb-comment-meta">
              <span className="sb-comment-author">{msg.author}</span>
              <span className="sb-comment-date">{formatDate(msg.createdAt)}</span>
            </div>
            {i === 0
              ? (
                <div className="sb-comment-body sb-comment-body-anchor">
                  {/* First message shows the anchor text as context */}
                  <em>Commented on:</em> "{comment.anchor}"
                </div>
              )
              : (
                <div className="sb-comment-body">{msg.body}</div>
              )}
          </div>
        ))}
      </div>

      {!comment.resolved && (
        <div className="sb-comment-reply">
          <textarea
            ref={inputRef}
            className="sb-comment-reply-input"
            placeholder="Reply…"
            value={replyText}
            rows={2}
            onInput={(e) =>
              setReplyText((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submitReply();
              }
              if (e.key === "Escape") onClose();
            }}
          />
          <button
            className="sb-comment-reply-btn"
            disabled={!replyText.trim() || submitting}
            onClick={submitReply}
          >
            Reply
          </button>
        </div>
      )}
    </div>
  );
}
```

Create `client/components/comment_add_dialog.tsx`:

```tsx
import { useEffect, useRef, useState } from "preact/hooks";

type Props = {
  anchor: string;
  currentUser: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
  top: number;
  left: number;
};

export function CommentAddDialog(
  { anchor, onSubmit, onCancel, top, left }: Props,
) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const submit = async () => {
    const body = text.trim();
    if (!body) return;
    setSubmitting(true);
    try {
      await onSubmit(body);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="sb-comment-add-dialog" style={{ top: `${top}px`, left: `${left}px` }}>
      <div className="sb-comment-add-context">
        "{anchor.slice(0, 60)}{anchor.length > 60 ? "…" : ""}"
      </div>
      <textarea
        ref={ref}
        className="sb-comment-add-input"
        placeholder="Add a comment…"
        value={text}
        rows={3}
        onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="sb-comment-add-footer">
        <button className="sb-comment-cancel-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="sb-comment-submit-btn"
          disabled={!text.trim() || submitting}
          onClick={submit}
        >
          Comment
        </button>
      </div>
    </div>
  );
}
```

---

## Part 5 — Wire up in editor_ui.tsx

Add state to the editor UI component:

```tsx
// Inside EditorUI component, alongside existing state
const [comments, setComments] = useState<Comment[]>([]);
const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
const [addDialog, setAddDialog] = useState<{
  anchor: string;
  anchorContext: string;
  top: number;
  left: number;
} | null>(null);
```

Load comments when the page changes:

```ts
useEffect(() => {
  if (!viewState.current) return;
  const pageName = getNameFromPath(viewState.current.path);
  if (!pageName) return;

  client.clientSystem.system.invokeFunction("comments.getComments", [pageName])
    .then((loaded: Comment[]) => {
      setComments(loaded);
      setActiveCommentId(null);
      client.editorView?.dispatch({
        effects: [setCommentsEffect.of(loaded)],
      });
    })
    .catch(console.error);
}, [viewState.current?.path]);
```

Pass the plugin to CodeMirror (add to the extensions array in the editor setup):

```ts
commentsPlugin(
  client,
  // onOpenThread
  (commentId) => {
    setActiveCommentId(commentId);
    client.editorView?.dispatch({
      effects: [openThreadEffect.of(commentId)],
    });
  },
  // onAddComment
  (anchor, anchorContext) => {
    const coords = /* get from last selection coordsAtPos call */ { top: 0, left: 0 };
    setAddDialog({ anchor, anchorContext, top: coords.top, left: coords.left });
  },
),
commentsField,
activeThreadField,
```

Render the panels in the JSX:

```tsx
{/* Comment thread panel */}
{activeCommentId && (() => {
  const comment = comments.find((c) => c.id === activeCommentId);
  if (!comment) return null;
  return (
    <CommentThread
      comment={comment}
      currentUser={client.currentUser ?? ""}
      anchorTop={200 /* derive from decoration position */}
      onClose={() => {
        setActiveCommentId(null);
        client.editorView?.dispatch({ effects: [openThreadEffect.of(null)] });
      }}
      onReply={async (body) => {
        const pageName = getNameFromPath(viewState.current!.path);
        await client.clientSystem.system.invokeFunction(
          "comments.addReply",
          [pageName, activeCommentId, body, client.currentUser],
        );
        const updated = await client.clientSystem.system.invokeFunction(
          "comments.getComments", [pageName]);
        setComments(updated);
        client.editorView?.dispatch({ effects: [setCommentsEffect.of(updated)] });
      }}
      onResolve={async () => {
        const pageName = getNameFromPath(viewState.current!.path);
        await client.clientSystem.system.invokeFunction(
          "comments.resolveComment", [pageName, activeCommentId]);
        const updated = await client.clientSystem.system.invokeFunction(
          "comments.getComments", [pageName]);
        setComments(updated);
        setActiveCommentId(null);
        client.editorView?.dispatch({
          effects: [setCommentsEffect.of(updated), openThreadEffect.of(null)],
        });
      }}
      onDelete={async () => {
        const pageName = getNameFromPath(viewState.current!.path);
        await client.clientSystem.system.invokeFunction(
          "comments.deleteComment", [pageName, activeCommentId]);
        const updated = await client.clientSystem.system.invokeFunction(
          "comments.getComments", [pageName]);
        setComments(updated);
        setActiveCommentId(null);
        client.editorView?.dispatch({
          effects: [setCommentsEffect.of(updated), openThreadEffect.of(null)],
        });
      }}
    />
  );
})()}

{/* Add comment dialog */}
{addDialog && (
  <CommentAddDialog
    anchor={addDialog.anchor}
    currentUser={client.currentUser ?? ""}
    top={addDialog.top}
    left={addDialog.left}
    onCancel={() => setAddDialog(null)}
    onSubmit={async (body) => {
      const pageName = getNameFromPath(viewState.current!.path);
      await client.clientSystem.system.invokeFunction("comments.addComment", [
        pageName,
        { anchor: addDialog.anchor, anchorContext: addDialog.anchorContext },
        client.currentUser,
      ]);
      const updated = await client.clientSystem.system.invokeFunction(
        "comments.getComments", [pageName]);
      setComments(updated);
      client.editorView?.dispatch({ effects: [setCommentsEffect.of(updated)] });
      setAddDialog(null);
    }}
  />
)}
```

---

## Part 6 — CSS

Add to `client/styles/editor.scss`:

```scss
// ── Comment highlights ─────────────────────────────────────────────────────────
.sb-comment-highlight {
  background: rgba(255, 200, 0, 0.25);
  border-bottom: 2px solid rgba(255, 180, 0, 0.6);
  cursor: pointer;
  &.active {
    background: rgba(255, 200, 0, 0.45);
  }
}

// ── Gutter icon ───────────────────────────────────────────────────────────────
.sb-comment-icon {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  padding: 0 2px;
  vertical-align: middle;
  opacity: 0.7;
  position: relative;
  &:hover { opacity: 1; }
  &.resolved { opacity: 0.35; font-size: 11px; }
}

.sb-comment-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background: var(--accent-color);
  color: #fff;
  font-size: 9px;
  border-radius: 8px;
  padding: 0 3px;
  line-height: 14px;
}

// ── Floating "add comment" button ─────────────────────────────────────────────
.sb-comment-add-btn {
  position: absolute;
  z-index: 100;
  background: var(--accent-color);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  white-space: nowrap;
  &:hover { filter: brightness(1.1); }
}

// ── Add comment dialog ────────────────────────────────────────────────────────
.sb-comment-add-dialog {
  position: absolute;
  z-index: 110;
  width: 300px;
  background: var(--modal-bg, var(--editor-bg));
  border: 1px solid var(--editor-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sb-comment-add-context {
  font-size: 12px;
  color: var(--editor-fg);
  opacity: 0.6;
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sb-comment-add-input {
  width: 100%;
  background: var(--editor-bg);
  border: 1px solid var(--editor-border);
  border-radius: 4px;
  padding: 6px 8px;
  font: inherit;
  font-size: 13px;
  color: var(--editor-fg);
  resize: none;
  outline: none;
  &:focus { border-color: var(--accent-color); }
}

.sb-comment-add-footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.sb-comment-cancel-btn,
.sb-comment-submit-btn {
  padding: 4px 12px;
  border-radius: 5px;
  font-size: 13px;
  cursor: pointer;
  border: none;
}
.sb-comment-cancel-btn {
  background: transparent;
  color: var(--editor-fg);
  &:hover { background: var(--nav-hover-bg, rgba(0,0,0,0.06)); }
}
.sb-comment-submit-btn {
  background: var(--accent-color);
  color: #fff;
  &:disabled { opacity: 0.4; cursor: default; }
  &:not(:disabled):hover { filter: brightness(1.1); }
}

// ── Thread panel ──────────────────────────────────────────────────────────────
.sb-comment-thread {
  position: absolute;
  right: 8px;
  z-index: 110;
  width: 280px;
  background: var(--modal-bg, var(--editor-bg));
  border: 1px solid var(--editor-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  max-height: 400px;
  overflow: hidden;
}

.sb-comment-thread-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid var(--editor-border);
  gap: 6px;
}

.sb-comment-anchor {
  font-size: 11px;
  font-style: italic;
  color: var(--editor-fg);
  opacity: 0.6;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sb-comment-thread-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.sb-comment-resolve-btn,
.sb-comment-delete-btn,
.sb-comment-close-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 5px;
  border-radius: 4px;
  color: var(--editor-fg);
  &:hover { background: var(--nav-hover-bg, rgba(0,0,0,0.07)); }
}

.sb-comment-messages {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sb-comment-message { display: flex; flex-direction: column; gap: 3px; }

.sb-comment-meta {
  display: flex;
  gap: 6px;
  font-size: 11px;
}

.sb-comment-author { font-weight: 600; color: var(--editor-fg); }
.sb-comment-date   { color: var(--editor-fg); opacity: 0.5; }

.sb-comment-body {
  font-size: 13px;
  color: var(--editor-fg);
  line-height: 1.5;
}

.sb-comment-body-anchor {
  font-style: italic;
  opacity: 0.7;
  font-size: 12px;
}

.sb-comment-reply {
  border-top: 1px solid var(--editor-border);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sb-comment-reply-input {
  background: var(--editor-bg);
  border: 1px solid var(--editor-border);
  border-radius: 4px;
  padding: 5px 7px;
  font: inherit;
  font-size: 13px;
  color: var(--editor-fg);
  resize: none;
  outline: none;
  &:focus { border-color: var(--accent-color); }
}

.sb-comment-reply-btn {
  align-self: flex-end;
  background: var(--accent-color);
  color: #fff;
  border: none;
  border-radius: 5px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  &:disabled { opacity: 0.4; cursor: default; }
  &:not(:disabled):hover { filter: brightness(1.1); }
}
```

---

## Files created / modified

| File | Change |
|---|---|
| `plug-api/lib/comments.ts` | NEW — shared `Comment` / `PageComments` types |
| `plugs/comments/comments.ts` | NEW — plug: getComments, addComment, addReply, resolveComment, deleteComment |
| `plugs/comments/index.plug.yaml` | NEW — plug manifest |
| `client/codemirror/comments.ts` | NEW — StateField, StateEffect, ViewPlugin |
| `client/components/comment_thread.tsx` | NEW — thread panel Preact component |
| `client/components/comment_add_dialog.tsx` | NEW — add comment dialog Preact component |
| `client/editor_ui.tsx` | Add comment state, load on page change, render panels |
| `client/styles/editor.scss` | Add comment CSS |

---

## Anchor robustness notes

- Anchors are matched by plain text search, not character offset. This means
  comments survive edits made above the commented text.
- If the anchor text is deleted from the page, the comment silently disappears
  from the UI (the icon is not rendered). The data remains in the JSON file and
  can be recovered if the text is restored.
- `anchorContext` (up to 30 chars before the selection) is used to pick the
  right occurrence when the same text appears multiple times on a page.
- For very long selections, only the first 100 characters are stored as the
  anchor; this is enough to uniquely identify the location in practice.

## Multi-user behaviour

- `_comments/PageName.json` is stored in the space like any other file. Any
  user with read access to the page can also read its comments (same folder
  permission prefix). Write access is needed to add/resolve.
- If two users add a comment simultaneously, the last write wins (same as page
  conflicts). For lab use this is acceptable. Full CRDT merge is out of scope.
