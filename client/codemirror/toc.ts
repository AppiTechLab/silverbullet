import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";

export type Heading = {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  from: number;
};

export function extractHeadings(state: EditorState): Heading[] {
  const headings: Heading[] = [];
  syntaxTree(state).iterate({
    enter: ({ type, from }) => {
      if (!type.name.startsWith("ATXHeading")) return;
      const level = parseInt(type.name.replace("ATXHeading", "")) as
        | 1
        | 2
        | 3
        | 4
        | 5
        | 6;
      const raw = state.sliceDoc(from, state.doc.lineAt(from).to);
      const spacePos = raw.indexOf(" ");
      if (spacePos === -1) return;
      const text = raw.slice(spacePos + 1).trim();
      if (text) headings.push({ level, text, from });
      return false; // skip heading children, they add nothing to the list
    },
  });
  return headings;
}

export function tocPlugin(
  onHeadingsChange: (h: Heading[]) => void,
): Extension {
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        onHeadingsChange(extractHeadings(view.state));
      }
      update(update: ViewUpdate) {
        if (update.docChanged) {
          onHeadingsChange(extractHeadings(update.state));
        }
      }
    },
  );
}
