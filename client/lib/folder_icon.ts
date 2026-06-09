import { emojiMap } from "../codemirror/emojiList.ts";

const SHORTCODE_RE = /^(:[a-z0-9_+-]+:)\s*/;
const RAW_EMOJI_RE = /^(\p{Extended_Pictographic})\s*/u;

export type FolderMeta = {
  prefix: string;
  icon: string;
  label: string;
};

export function parseFolderMeta(folderName: string): FolderMeta {
  const shortcodeMatch = folderName.match(SHORTCODE_RE);
  if (shortcodeMatch) {
    const emoji = emojiMap[shortcodeMatch[1]];
    if (emoji) {
      return {
        prefix: folderName,
        icon: emoji,
        label: folderName.slice(shortcodeMatch[0].length).trim() || folderName,
      };
    }
  }

  const rawMatch = folderName.match(RAW_EMOJI_RE);
  if (rawMatch) {
    return {
      prefix: folderName,
      icon: rawMatch[1],
      label: folderName.slice(rawMatch[0].length).trim() || folderName,
    };
  }

  return { prefix: folderName, icon: "", label: folderName };
}

export function topLevelFolders(pages: { name: string }[]): string[] {
  const seen = new Set<string>();
  for (const page of pages) {
    const slash = page.name.indexOf("/");
    if (slash > 0) seen.add(page.name.slice(0, slash));
  }
  return Array.from(seen).sort();
}
