// GitLab API client, ported from obsidian-gitlab-tasks. Uses the plug
// sandbox's fetch, which is proxied through the SilverBullet server (no CORS).

import type {
  GitLabGroup,
  GitLabIssue,
  GitLabMember,
  GitLabMilestone,
  GitLabProject,
  GitLabTasksConfig,
  PushTask,
  WikiUrl,
} from "./types.ts";

interface GitLabUser {
  id: number;
  username: string;
  name: string;
}

/**
 * Resolve a short project name (e.g. "gate") to a full `path_with_namespace`
 * by matching against the last segment of each project's path. Matching is
 * case-insensitive. Returns the fallback path when no project matches.
 */
export function resolveProjectPath(
  name: string | undefined,
  projects: GitLabProject[],
  fallbackPath: string,
): string {
  if (!name) return fallbackPath;

  // If the user already provided a path or numeric id, use as-is.
  if (/^\d+$/.test(name) || name.includes("/")) return name;

  const needle = name.toLowerCase();

  // 1. Exact last-segment match.
  const exact = projects.find((p) => {
    const last = p.path_with_namespace.split("/").pop() || "";
    return last.toLowerCase() === needle;
  });
  if (exact) return exact.path_with_namespace;

  // 2. Last-segment contains the needle.
  const partial = projects.find((p) => {
    const last = p.path_with_namespace.split("/").pop() || "";
    return last.toLowerCase().includes(needle);
  });
  if (partial) return partial.path_with_namespace;

  // 3. Any segment of the path matches.
  const anySegment = projects.find((p) =>
    p.path_with_namespace
      .toLowerCase()
      .split("/")
      .some((seg) => seg === needle)
  );
  if (anySegment) return anySegment.path_with_namespace;

  return fallbackPath;
}

export class GitLabClient {
  private baseUrl: string;
  private token: string;
  private defaultProject: string;

  constructor(private config: GitLabTasksConfig) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.token = config.token;
    this.defaultProject = encodeURIComponent(config.defaultProject);
  }

  private headers(): Record<string, string> {
    return {
      "PRIVATE-TOKEN": this.token,
      "Content-Type": "application/json",
    };
  }

  private async request(
    path: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<{ status: number; json: any }> {
    const response = await fetch(`${this.baseUrl}/api/v4${path}`, {
      method: options.method ?? "GET",
      headers: this.headers(),
      body: options.body !== undefined
        ? JSON.stringify(options.body)
        : undefined,
    });
    let json: any = null;
    try {
      json = await response.json();
    } catch {
      // Non-JSON response body
    }
    return { status: response.status, json };
  }

  private async getPaginated<T>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const query = new URLSearchParams({
        ...params,
        per_page: String(perPage),
        page: String(page),
      });
      const sep = path.includes("?") ? "&" : "?";
      const { status, json } = await this.request(`${path}${sep}${query}`);
      if (status !== 200) {
        throw new Error(`GitLab API error: ${status}`);
      }
      const items = json as T[];
      all.push(...items);
      if (items.length < perPage) break;
      page++;
    }
    return all;
  }

  async testConnection(): Promise<boolean> {
    try {
      const { status } = await this.request(
        `/projects/${this.defaultProject}`,
      );
      return status === 200;
    } catch {
      return false;
    }
  }

  async createIssue(
    task: PushTask,
    wikiUrls: WikiUrl[] = [],
  ): Promise<GitLabIssue> {
    const project = task.projectId
      ? encodeURIComponent(task.projectId)
      : this.defaultProject;
    const labels = this.buildLabels(task);

    // Extract markdown links from the task text so they go into the
    // description, not the title.
    const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
    const extractedLinks: { label: string; url: string }[] = [];
    let match: RegExpExecArray | null;
    while ((match = MARKDOWN_LINK_REGEX.exec(task.text)) !== null) {
      extractedLinks.push({ label: match[1], url: match[2] });
    }
    const cleanTitle = task.text
      .replace(MARKDOWN_LINK_REGEX, "")
      .replace(/\s{2,}/g, " ")
      .trim();

    const description = this.buildDescription(task, wikiUrls, extractedLinks);

    const body: Record<string, unknown> = {
      title: cleanTitle,
      description,
      labels: labels.join(","),
    };

    if (task.assignees && task.assignees.length > 0) {
      const userIds = (
        await Promise.all(task.assignees.map((u) => this.getUserId(u)))
      ).filter((id): id is number => id !== null);
      if (userIds.length > 0) {
        body.assignee_ids = userIds;
      }
    }

    if (task.dueDate) {
      body.due_date = task.dueDate;
    }

    // Milestone resolution
    if (task.milestoneTag) {
      const projectConfig = task.projectId
        ? this.config.projectRegistry[task.projectId]
        : undefined;
      const milestoneConfig = projectConfig?.milestones?.find(
        (m) => m.tag === task.milestoneTag,
      );
      if (milestoneConfig && milestoneConfig.gitlabId > 0) {
        body.milestone_id = milestoneConfig.gitlabId;
      } else {
        // Fall back: fetch milestones from GitLab and match by title
        try {
          const milestones = await this.fetchMilestones(task.projectId);
          const needle = task.milestoneTag.replace(/_/g, " ").toLowerCase();
          const found = milestones.find(
            (m) => m.title.toLowerCase() === needle,
          );
          if (found) {
            body.milestone_id = found.id;
          } else {
            console.warn(
              `GitLab Tasks: milestone "${task.milestoneTag}" not found for project "${
                task.projectId ?? "default"
              }"`,
            );
          }
        } catch (e) {
          console.warn(
            "GitLab Tasks: failed to fetch milestones for resolution",
            e,
          );
        }
      }
    }

    const { status, json } = await this.request(
      `/projects/${project}/issues`,
      { method: "POST", body },
    );

    if (status !== 201) {
      throw new Error(`GitLab API error: ${status} ${JSON.stringify(json)}`);
    }

    return json as GitLabIssue;
  }

  async getIssuesByIids(
    iids: number[],
    projectOverride?: string,
  ): Promise<GitLabIssue[]> {
    if (iids.length === 0) return [];

    const project = projectOverride
      ? encodeURIComponent(projectOverride)
      : this.defaultProject;
    const params = iids.map((iid) => `iids[]=${iid}`).join("&");
    const { status, json } = await this.request(
      `/projects/${project}/issues?${params}&per_page=100`,
    );

    if (status !== 200) {
      throw new Error(`GitLab API error: ${status}`);
    }

    return json as GitLabIssue[];
  }

  async fetchProjectMembers(): Promise<GitLabMember[]> {
    const allMembers = await this.getPaginated<GitLabMember>(
      `/projects/${this.defaultProject}/members/all`,
    );

    // Fetch last_activity_on for each member from their user profile
    for (const member of allMembers) {
      try {
        const { status, json } = await this.request(`/users/${member.id}`);
        if (status === 200) {
          member.last_activity_on = json.last_activity_on ?? null;
        }
      } catch {
        // keep null
      }
    }

    // Sort by last_activity_on descending (nulls last)
    allMembers.sort((a, b) => {
      if (!a.last_activity_on && !b.last_activity_on) return 0;
      if (!a.last_activity_on) return 1;
      if (!b.last_activity_on) return -1;
      return b.last_activity_on.localeCompare(a.last_activity_on);
    });

    return allMembers;
  }

  fetchActiveProjects(): Promise<GitLabProject[]> {
    return this.getPaginated<GitLabProject>("/projects", {
      membership: "true",
      archived: "false",
      order_by: "last_activity_at",
      sort: "desc",
    });
  }

  async fetchMilestones(
    projectOverride?: string,
  ): Promise<GitLabMilestone[]> {
    const project = projectOverride
      ? encodeURIComponent(projectOverride)
      : this.defaultProject;
    return await this.getPaginated<GitLabMilestone>(
      `/projects/${project}/milestones`,
    );
  }

  private async getAllSubgroups(
    groupId: number | string,
  ): Promise<GitLabGroup[]> {
    const subgroups = await this.getPaginated<GitLabGroup>(
      `/groups/${groupId}/subgroups`,
    );
    const all: GitLabGroup[] = [...subgroups];
    for (const sg of subgroups) {
      all.push(...(await this.getAllSubgroups(sg.id)));
    }
    return all;
  }

  private async hasWikiPages(apiPath: string): Promise<boolean> {
    try {
      const { status, json } = await this.request(
        `${apiPath}?per_page=1&page=1`,
      );
      if (status !== 200) return false;
      return (json as unknown[]).length > 0;
    } catch {
      return false;
    }
  }

  async getAllWikiUrls(rootGroupId: string | number): Promise<WikiUrl[]> {
    const allWikiUrls: WikiUrl[] = [];

    // Check the root group itself
    try {
      const { status, json } = await this.request(`/groups/${rootGroupId}`);
      if (status === 200) {
        const rootGroup = json as GitLabGroup;
        if (await this.hasWikiPages(`/groups/${rootGroup.id}/wikis`)) {
          allWikiUrls.push({
            type: "group",
            namespace: rootGroup.full_path,
            url: `${rootGroup.web_url}/-/wikis/`,
          });
        }
      }
    } catch {
      // skip root group if unreachable
    }

    const subgroups = await this.getAllSubgroups(rootGroupId);
    for (const group of subgroups) {
      if (await this.hasWikiPages(`/groups/${group.id}/wikis`)) {
        allWikiUrls.push({
          type: "group",
          namespace: group.full_path,
          url: `${group.web_url}/-/wikis/`,
        });
      }
      const projects = await this.getPaginated<GitLabProject>(
        `/groups/${group.id}/projects`,
      );
      for (const project of projects) {
        if (await this.hasWikiPages(`/projects/${project.id}/wikis`)) {
          allWikiUrls.push({
            type: "project",
            namespace: project.path_with_namespace,
            url: `${project.web_url}/-/wikis/`,
          });
        }
      }
    }
    return allWikiUrls;
  }

  async getUserId(username: string): Promise<number | null> {
    try {
      const { status, json } = await this.request(
        `/users?username=${encodeURIComponent(username)}`,
      );
      if (status !== 200) return null;
      const users = json as GitLabUser[];
      if (users.length === 0) return null;
      return users[0].id;
    } catch {
      return null;
    }
  }

  private buildLabels(task: PushTask): string[] {
    const labels: string[] = [];
    if (this.config.labelPrefix) labels.push(this.config.labelPrefix);
    for (const tag of task.tags) {
      labels.push(tag);
      const activity = this.config.activityLabels[tag.toLowerCase()];
      if (activity) {
        labels.push(activity);
      }
    }

    // WP label mapping
    if (task.wpTag) {
      const projectConfig = task.projectId
        ? this.config.projectRegistry[task.projectId]
        : undefined;
      const wpConfig = projectConfig?.wps?.find((w) => w.tag === task.wpTag);
      labels.push(wpConfig ? wpConfig.label : task.wpTag);
    }

    if (this.config.inboxLabel) labels.push(this.config.inboxLabel);
    return labels;
  }

  private buildDescription(
    task: PushTask,
    wikiUrls: WikiUrl[],
    links: { label: string; url: string }[] = [],
  ): string {
    const lines: string[] = [];
    const resolvedWiki = resolveWikiUrlFromPath(task.page, wikiUrls);
    if (resolvedWiki) {
      const fileName = getWikiDisplayName(task.page);
      lines.push(`**Source:** [${fileName}](${resolvedWiki.url}${fileName})`);
    } else if (this.config.sourceBaseUrl) {
      const base = this.config.sourceBaseUrl.replace(/\/$/, "");
      lines.push(
        `**Source:** [${task.page}](${base}/${
          task.page.split("/").map(encodeURIComponent).join("/")
        })`,
      );
    }
    if (task.tags.length > 0) {
      lines.push(`**Tags:** ${task.tags.map((t) => `#${t}`).join(", ")}`);
    }
    if (links.length > 0) {
      lines.push(
        `**Links:** ${links.map((l) => `[${l.label}](${l.url})`).join(" · ")}`,
      );
    }
    lines.push("", "*Created automatically by the SilverBullet GitLab Tasks plug.*");
    return lines.join("\n");
  }
}

/**
 * Pages under a folder named `<prefix>GitLabWiki` are mapped to the GitLab
 * wiki whose namespace's last segment matches `<prefix>` (same convention as
 * the Obsidian plugin).
 */
export function resolveWikiUrlFromPath(
  pageName: string,
  wikiUrls: WikiUrl[],
): WikiUrl | null {
  const match = pageName.match(/([^/]+)GitLabWiki/i);
  if (!match) return null;
  const prefix = match[1].toLowerCase();
  return (
    wikiUrls.find(
      (w) => w.namespace.split("/").pop()?.toLowerCase() === prefix,
    ) ?? null
  );
}

function getWikiDisplayName(pageName: string): string {
  const match = pageName.match(/[^/]+GitLabWiki\//i);
  if (!match || match.index === undefined) return pageName;
  return pageName.slice(match.index + match[0].length);
}

export function extractProjectPathFromUrl(
  issueUrl: string,
  baseUrl: string,
): string {
  const cleanBase = baseUrl.replace(/\/$/, "");
  const path = issueUrl.replace(cleanBase + "/", "");
  const match = path.match(/^(.+)\/-\/(?:issues|work_items)\/\d+$/);
  return match ? match[1] : "";
}
