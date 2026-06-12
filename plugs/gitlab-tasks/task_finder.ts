// Finds tasks to push/pull using SilverBullet's object index (no full-space
// regex scans like the Obsidian original — tasks are already indexed).

import { index, space } from "@silverbulletmd/silverbullet/syscalls";
import type {
  GitLabTasksConfig,
  PushTask,
  SyncedTask,
} from "./types.ts";
import { extractProjectPathFromUrl } from "./gitlab_client.ts";

export const ISSUE_LINK_REGEX =
  /\[GL-#(\d+)\]\((https?:\/\/[^)]+\/(?:issues|work_items)\/\d+)\)/;

const TASK_LINE_REGEX = /^(\s*(?:[-*+]|\d+\.))\s+\[(.)\]\s+(.*)$/;

/** Minimal shape of an indexed task object (see plugs/index/item.ts) */
interface IndexedTask {
  ref: string;
  page: string;
  pos: number;
  name: string;
  done: boolean;
  state: string;
  tags?: string[];
  [attribute: string]: any;
}

function attributeAsString(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}

function attributeAsList(value: any): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map(String);
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Strips any remaining inline attributes/tags from a task title. */
function cleanTitle(text: string): string {
  return text
    .replace(/\[\w+:[^\]]*\]/g, "") // leftover [attr: value]
    .replace(/(^|\s)#[\w/-]+/g, " ") // leftover #tags
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Finds tasks that should be pushed to GitLab: not done, not yet synced
 * (no GL-link), and routed to a project via the project attribute
 * ([gitlab: myrepo]) or project tag (#gl/myrepo).
 */
export async function findTasksToPush(
  config: GitLabTasksConfig,
): Promise<PushTask[]> {
  const tasks = await index.queryLuaObjects<IndexedTask>("task", {});
  const result: PushTask[] = [];
  const tagPrefix = config.projectTagPrefix.replace(/\/$/, "") + "/";
  const assignPrefix = config.assignTagPrefix.replace(/\/$/, "") + "/";

  for (const task of tasks) {
    if (task.done) continue;
    if (ISSUE_LINK_REGEX.test(task.name)) continue; // already synced

    const tags: string[] = task.tags ?? [];

    // Project routing: attribute first, then tag prefix
    let projectId = attributeAsString(task[config.projectAttribute]);
    let projectTag: string | undefined;
    if (!projectId) {
      projectTag = tags.find((t) =>
        t.toLowerCase().startsWith(tagPrefix.toLowerCase())
      );
      if (projectTag) {
        projectId = projectTag.slice(tagPrefix.length);
      }
    }
    if (!projectId) continue; // not routed to GitLab

    // Assignees: attribute plus tags (#assign/jdoe)
    const assignTags = tags.filter((t) =>
      t.toLowerCase().startsWith(assignPrefix.toLowerCase())
    );
    const assignees = [
      ...(attributeAsList(task[config.assignAttribute]) ?? []),
      ...assignTags.map((t) => t.slice(assignPrefix.length)),
    ];

    result.push({
      text: cleanTitle(task.name),
      tags: tags.filter((t) => t !== projectTag && !assignTags.includes(t)),
      page: task.page,
      pos: task.pos,
      projectId,
      assignees: assignees.length > 0 ? assignees : undefined,
      dueDate: attributeAsString(task[config.dueAttribute]),
      milestoneTag: attributeAsString(task[config.milestoneAttribute]),
      wpTag: attributeAsString(task[config.wpAttribute]),
    });
  }

  return result;
}

/**
 * Finds open tasks that have been synced before (carry a GL-link), so their
 * completion state can be pulled from GitLab.
 */
export async function findSyncedOpenTasks(
  config: GitLabTasksConfig,
): Promise<SyncedTask[]> {
  const tasks = await index.queryLuaObjects<IndexedTask>("task", {});
  const result: SyncedTask[] = [];

  for (const task of tasks) {
    if (task.done) continue;
    const match = ISSUE_LINK_REGEX.exec(task.name);
    if (!match) continue;

    result.push({
      page: task.page,
      pos: task.pos,
      issueIid: parseInt(match[1], 10),
      issueUrl: match[2],
      projectPath: extractProjectPathFromUrl(match[2], config.url),
    });
  }

  return result;
}

/** Locates the line containing character offset `pos` in `text`. */
function lineAt(
  text: string,
  pos: number,
): { start: number; end: number; line: string } | null {
  if (pos < 0 || pos > text.length) return null;
  const start = text.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  let end = text.indexOf("\n", pos);
  if (end === -1) end = text.length;
  return { start, end, line: text.slice(start, end) };
}

/**
 * Appends the GitLab issue link to the task line, marking it as synced:
 *   * [ ] My task [gitlab: x] [GL-#12](https://...)
 * Returns false when the line no longer looks like the expected task.
 */
export async function markTaskSynced(
  page: string,
  pos: number,
  issueIid: number,
  issueUrl: string,
): Promise<boolean> {
  const text = await space.readPage(page);
  const loc = lineAt(text, pos);
  if (!loc || !TASK_LINE_REGEX.test(loc.line)) return false;

  const updated = `${loc.line.trimEnd()} [GL-#${issueIid}](${issueUrl})`;
  await space.writePage(
    page,
    text.slice(0, loc.start) + updated + text.slice(loc.end),
  );
  return true;
}

/** Checks off the task at the given position: `[ ]` becomes `[x]`. */
export async function markTaskCompleted(
  page: string,
  pos: number,
): Promise<boolean> {
  const text = await space.readPage(page);
  const loc = lineAt(text, pos);
  if (!loc) return false;
  const match = TASK_LINE_REGEX.exec(loc.line);
  if (!match || match[2] !== " ") return false;

  const updated = loc.line.replace(/\[ \]/, "[x]");
  await space.writePage(
    page,
    text.slice(0, loc.start) + updated + text.slice(loc.end),
  );
  return true;
}
