import type { Heading } from "../codemirror/toc.ts";
import { emojiMap } from "../codemirror/emojiList.ts";

const EMOJI_RE = /:[a-z0-9_+-]+:/g;
function replaceEmoji(text: string): string {
  return text.replace(EMOJI_RE, (m) => emojiMap[m] ?? m);
}

interface TocProps {
  headings: Heading[];
  activeHeading: number;
  onHeadingClick: (from: number) => void;
}

export function Toc({ headings, activeHeading, onHeadingClick }: TocProps) {
  if (headings.length === 0) return null;
  return (
    <div id="sb-toc">
      <div className="sb-toc-title">TABLE OF CONTENTS</div>
      <div className="sb-toc-divider" />
      {headings.map((h, i) => (
        <div
          key={i}
          className={`sb-toc-item${i === activeHeading ? " active" : ""}`}
          style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
          onClick={() => onHeadingClick(h.from)}
          title={replaceEmoji(h.text)}
        >
          {replaceEmoji(h.text)}
        </div>
      ))}
    </div>
  );
}
