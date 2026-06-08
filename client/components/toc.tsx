import type { Heading } from "../codemirror/toc.ts";

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
          title={h.text}
        >
          {h.text}
        </div>
      ))}
    </div>
  );
}
