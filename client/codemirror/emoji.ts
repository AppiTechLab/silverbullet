import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { isCursorInRange } from "./util.ts";
import { emojiMap } from "./emojiList.ts";

const EMOJI_RE = /:[a-z0-9_+-]+:/g;

class EmojiWidget extends WidgetType {
  constructor(
    readonly emoji: string,
    readonly shortcode: string,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "sb-emoji";
    span.title = this.shortcode;
    span.textContent = this.emoji;
    return span;
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof EmojiWidget &&
      other.emoji === this.emoji &&
      other.shortcode === this.shortcode
    );
  }
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const matches: { from: number; to: number; widget: EmojiWidget }[] = [];

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.sliceDoc(from, to);
    EMOJI_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = EMOJI_RE.exec(text)) !== null) {
      const shortcode = match[0];
      const emoji = emojiMap[shortcode];
      if (!emoji) continue;

      const mFrom = from + match.index;
      const mTo = mFrom + shortcode.length;

      if (isCursorInRange(view.state, [mFrom, mTo])) continue;

      matches.push({ from: mFrom, to: mTo, widget: new EmojiWidget(emoji, shortcode) });
    }
  }

  // RangeSetBuilder requires ranges in ascending order
  matches.sort((a, b) => a.from - b.from);
  for (const { from, to, widget } of matches) {
    builder.add(from, to, Decoration.replace({ widget }));
  }

  return builder.finish();
}

export function emojiPlugin() {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
