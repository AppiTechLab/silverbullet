// GitLab Tasks plug: push SilverBullet tasks to GitLab issues and pull
// closed issues back. Ported from the obsidian-gitlab-tasks plugin.
//
// Configuration lives under the `gitlabTasks` config key, e.g. in CONFIG:
//
// ```space-lua
// config.set("gitlabTasks", {
//   url = "https://gitlab.example.com",
//   token = "glpat-...",
//   defaultProject = "group/project",
// })
// ```

import { editor, space, system } from "@silverbulletmd/silverbullet/syscalls";
import {
  DEFAULT_CONFIG,
  type GitLabTasksConfig,
  type SyncedTask,
  type WikiUrl,
} from "./types.ts";
import { GitLabClient, resolveProjectPath } from "./gitlab_client.ts";
import {
  findSyncedOpenTasks,
  findTasksToPush,
  markTaskCompleted,
  markTaskSynced,
} from "./task_finder.ts";

async function getConfig(): Promise<GitLabTasksConfig> {
  const userConfig = await system.getConfig<Partial<GitLabTasksConfig>>(
    "gitlabTasks",
    {},
  );
  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    activityLabels: {
      ...DEFAULT_CONFIG.activityLabels,
      ...(userConfig.activityLabels ?? {}),
    },
  };
}

function checkConfig(config: GitLabTasksConfig, needProject = true): boolean {
  if (!config.token || (needProject && !config.defaultProject)) {
    editor.flashNotification(
      "Please configure gitlabTasks.token and gitlabTasks.defaultProject in CONFIG.",
      "error",
    );
    return false;
  }
  return true;
}

export async function pushTasks() {
  const config = await getConfig();
  if (!checkConfig(config)) return;

  await editor.save();
  const tasks = await findTasksToPush(config);
  if (tasks.length === 0) {
    await editor.flashNotification("No unsynced GitLab tasks found.");
    return;
  }

  const preview = tasks
    .slice(0, 8)
    .map((t) => `• ${t.text} → ${t.projectId}`)
    .join("\n");
  const more = tasks.length > 8 ? `\n… and ${tasks.length - 8} more` : "";
  const ok = await editor.confirm(
    `Push ${tasks.length} task(s) to GitLab?\n\n${preview}${more}`,
  );
  if (!ok) return;

  const client = new GitLabClient(config);

  // Resolve short project names against active GitLab projects
  const needsResolution = tasks.some(
    (t) => t.projectId && !/^\d+$/.test(t.projectId) && !t.projectId.includes("/"),
  );
  if (needsResolution) {
    try {
      const projects = await client.fetchActiveProjects();
      for (const task of tasks) {
        task.projectId = resolveProjectPath(
          task.projectId,
          projects,
          config.fallbackProject || config.defaultProject,
        );
      }
    } catch (e) {
      console.error("GitLab Tasks: failed to fetch projects for resolution", e);
      await editor.flashNotification(
        "Failed to fetch GitLab projects. Check console.",
        "error",
      );
      return;
    }
  }

  // Wiki URLs for source links (optional)
  let wikiUrls: WikiUrl[] = [];
  if (config.rootGroupId) {
    try {
      wikiUrls = await client.getAllWikiUrls(config.rootGroupId);
    } catch (e) {
      console.warn("GitLab Tasks: failed to fetch wiki URLs", e);
    }
  }

  // Process per page, bottom-up, so earlier task positions stay valid while
  // we append issue links to lines.
  const sorted = [...tasks].sort((a, b) =>
    a.page === b.page ? b.pos - a.pos : a.page.localeCompare(b.page)
  );

  let created = 0;
  let failed = 0;
  for (const task of sorted) {
    try {
      const issue = await client.createIssue(task, wikiUrls);
      const marked = await markTaskSynced(
        task.page,
        task.pos,
        issue.iid,
        issue.web_url,
      );
      if (!marked) {
        console.warn(
          `GitLab Tasks: created issue #${issue.iid} but could not mark task in "${task.page}"`,
        );
      }
      created++;
    } catch (e) {
      console.error(`GitLab Tasks: failed to push "${task.text}"`, e);
      failed++;
    }
  }

  const parts: string[] = [];
  if (created > 0) parts.push(`Created ${created} issue(s).`);
  if (failed > 0) parts.push(`${failed} failed (check console).`);
  await editor.flashNotification(
    parts.join(" "),
    failed > 0 ? "error" : "info",
  );
}

export async function pullClosedIssues() {
  const config = await getConfig();
  if (!checkConfig(config)) return;

  await editor.save();
  const syncedTasks = await findSyncedOpenTasks(config);
  if (syncedTasks.length === 0) {
    await editor.flashNotification("No open synced tasks found.");
    return;
  }

  const client = new GitLabClient(config);

  // Group synced tasks by project
  const byProject = new Map<string, SyncedTask[]>();
  for (const task of syncedTasks) {
    const key = task.projectPath || config.defaultProject;
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(task);
  }

  let completed = 0;
  let skipped = 0;
  for (const [projectPath, tasks] of byProject) {
    try {
      const issues = await client.getIssuesByIids(
        tasks.map((t) => t.issueIid),
        projectPath,
      );
      const closedIids = new Set(
        issues.filter((i) => i.state === "closed").map((i) => i.iid),
      );

      for (const task of tasks) {
        if (closedIids.has(task.issueIid)) {
          if (await markTaskCompleted(task.page, task.pos)) {
            completed++;
          }
        }
      }
    } catch (e) {
      console.warn(`GitLab Tasks: skipping project "${projectPath}" — ${e}`);
      skipped += tasks.length;
    }
  }

  const parts: string[] = [];
  if (completed > 0) parts.push(`Marked ${completed} task(s) as completed.`);
  if (skipped > 0) parts.push(`Skipped ${skipped} task(s) due to errors.`);
  if (parts.length === 0) {
    parts.push("No closed issues found — all synced tasks are still open.");
  }
  await editor.flashNotification(parts.join(" "));
}

export async function fetchMembers() {
  const config = await getConfig();
  if (!checkConfig(config)) return;

  const client = new GitLabClient(config);
  try {
    await editor.flashNotification("Fetching project members from GitLab…");
    const members = await client.fetchProjectMembers();

    const accessLevelName = (level: number): string => {
      const levels: Record<number, string> = {
        10: "Guest",
        20: "Reporter",
        30: "Developer",
        40: "Maintainer",
        50: "Owner",
      };
      return levels[level] || String(level);
    };

    const lines: string[] = [
      "# GitLab Project Members",
      "",
      `> Fetched on ${
        new Date().toISOString().slice(0, 19).replace("T", " ")
      } — ${members.length} member(s) — project \`${config.defaultProject}\``,
      "",
      "| # | Member | Username | Role | Last Activity | Tag |",
      "|---|--------|----------|------|---------------|-----|",
    ];

    members.forEach((m, i) => {
      const activity = m.last_activity_on || "N/A";
      lines.push(
        `| ${i + 1} | [${m.name}](${m.web_url}) | @${m.username} | ${
          accessLevelName(m.access_level)
        } | ${activity} | \`#${
          config.assignTagPrefix.replace(/\/$/, "")
        }/${m.username}\` |`,
      );
    });

    await space.writePage(config.membersPage, lines.join("\n"));
    await editor.flashNotification(
      `Wrote ${members.length} members to "${config.membersPage}".`,
    );
  } catch (e) {
    console.error("GitLab Tasks: failed to fetch members", e);
    await editor.flashNotification(
      "Failed to fetch members. Check console.",
      "error",
    );
  }
}

export async function fetchRepositories() {
  const config = await getConfig();
  if (!checkConfig(config, false)) return;

  const client = new GitLabClient(config);
  try {
    await editor.flashNotification("Fetching active repositories from GitLab…");
    const allProjects = await client.fetchActiveProjects();
    const projects = config.repositoryPathPrefix
      ? allProjects.filter((p) =>
        p.path_with_namespace.startsWith(config.repositoryPathPrefix)
      )
      : allProjects;

    const lines: string[] = [
      "# Active GitLab Repositories",
      "",
      `> Fetched on ${
        new Date().toISOString().slice(0, 19).replace("T", " ")
      } — ${projects.length} project(s)`,
      "",
      "| # | Project | ID | Last Activity | Tag |",
      "|---|---------|-----|---------------|-----|",
    ];

    projects.forEach((p, i) => {
      const date = new Date(p.last_activity_at).toISOString().slice(0, 10);
      const repoName = p.path_with_namespace.split("/").pop()?.toLowerCase() ||
        "";
      lines.push(
        `| ${i + 1} | [${p.name_with_namespace}](${p.web_url}) | ${p.id} | ${date} | \`#${
          config.projectTagPrefix.replace(/\/$/, "")
        }/${repoName}\` |`,
      );
    });

    await space.writePage(config.repositoriesPage, lines.join("\n"));
    await editor.flashNotification(
      `Wrote ${projects.length} repositories to "${config.repositoriesPage}".`,
    );
  } catch (e) {
    console.error("GitLab Tasks: failed to fetch repositories", e);
    await editor.flashNotification(
      "Failed to fetch repositories. Check console.",
      "error",
    );
  }
}

export async function fetchWikiPages() {
  const config = await getConfig();
  if (!checkConfig(config, false)) return;
  if (!config.rootGroupId) {
    await editor.flashNotification(
      "Please configure gitlabTasks.rootGroupId in CONFIG.",
      "error",
    );
    return;
  }

  const client = new GitLabClient(config);
  try {
    await editor.flashNotification("Fetching wiki pages from GitLab…");
    const wikiUrls = await client.getAllWikiUrls(config.rootGroupId);

    const lines: string[] = [
      "# GitLab Wiki Pages",
      "",
      `> Fetched on ${
        new Date().toISOString().slice(0, 19).replace("T", " ")
      } — ${wikiUrls.length} wiki(s)`,
      "",
      "| # | Type | Namespace | URL |",
      "|---|------|-----------|-----|",
    ];

    wikiUrls.forEach((w, i) => {
      lines.push(
        `| ${i + 1} | ${w.type} | ${w.namespace} | [${w.namespace}](${w.url}) |`,
      );
    });

    await space.writePage(config.wikiPagesPage, lines.join("\n"));
    await editor.flashNotification(
      `Wrote ${wikiUrls.length} wiki(s) to "${config.wikiPagesPage}".`,
    );
  } catch (e) {
    console.error("GitLab Tasks: failed to fetch wiki pages", e);
    await editor.flashNotification(
      "Failed to fetch wiki pages. Check console.",
      "error",
    );
  }
}

export async function testConnection() {
  const config = await getConfig();
  if (!checkConfig(config)) return;

  const client = new GitLabClient(config);
  const ok = await client.testConnection();
  await editor.flashNotification(
    ok
      ? "GitLab connection OK."
      : "GitLab connection failed. Check url/token/defaultProject.",
    ok ? "info" : "error",
  );
}
