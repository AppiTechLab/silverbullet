// Types for the GitLab Tasks plug, ported from the obsidian-gitlab-tasks
// plugin. Tasks are matched via SilverBullet attribute syntax:
//
//   * [ ] Fix the build [gitlab: myrepo] [assign: jdoe] [due: 2026-07-01] [ms: m1] [wp: wp2]
//
// Project routing and assignment also work with tags (configurable prefixes):
//
//   * [ ] Fix the build #PM/gitlab/myrepo #PM/assign/jdoe [due: 2026-07-01]

export interface WpConfig {
  tag: string;
  label: string;
}

export interface MilestoneConfig {
  tag: string;
  gitlabId: number;
  title: string;
  dueDate?: string;
}

export interface ProjectConfig {
  gitlabProjectId: number;
  milestones?: MilestoneConfig[];
  wps?: WpConfig[];
}

export type ProjectRegistry = Record<string, ProjectConfig>;

export interface GitLabTasksConfig {
  /** GitLab instance base URL */
  url: string;
  /** Personal access token */
  token: string;
  /** Default project (path with namespace or numeric id) */
  defaultProject: string;
  /** Fallback project when a short name can't be resolved */
  fallbackProject: string;
  /** Attribute that routes a task to a project: [gitlab: myrepo] */
  projectAttribute: string;
  /** Tag prefix that routes a task to a project: #PM/gitlab/myrepo */
  projectTagPrefix: string;
  /** Attribute for assignees: [assign: user1,user2] */
  assignAttribute: string;
  /** Tag prefix for assignees: #PM/assign/jdoe */
  assignTagPrefix: string;
  /** Attribute for due date: [due: 2026-07-01] */
  dueAttribute: string;
  /** Attribute for milestone: [ms: m1] */
  milestoneAttribute: string;
  /** Attribute for Work Package: [wp: wp2] */
  wpAttribute: string;
  /** Label added to every synced issue (identifies the source) */
  labelPrefix: string;
  /** Label added to every synced issue for workflow status */
  inboxLabel: string;
  /** Map of task tag (without #) to GitLab label, e.g. pm/ongoing -> Activity::Ongoing */
  activityLabels: Record<string, string>;
  /** Project registry: short name -> milestones / WPs / project id */
  projectRegistry: ProjectRegistry;
  /** Page names for fetched GitLab data */
  membersPage: string;
  repositoriesPage: string;
  wikiPagesPage: string;
  /** Root group id for wiki URL discovery (optional) */
  rootGroupId: string;
  /** Only list repositories whose path starts with this prefix (optional) */
  repositoryPathPrefix: string;
  /** Base URL of this SilverBullet instance, used for source links (optional) */
  sourceBaseUrl: string;
}

export const DEFAULT_CONFIG: GitLabTasksConfig = {
  url: "https://gitlab.com",
  token: "",
  defaultProject: "",
  fallbackProject: "",
  projectAttribute: "gitlab",
  projectTagPrefix: "PM/gitlab/",
  assignAttribute: "assign",
  assignTagPrefix: "PM/assign/",
  dueAttribute: "due",
  milestoneAttribute: "ms",
  wpAttribute: "wp",
  labelPrefix: "silverbullet",
  inboxLabel: "Status::Inbox",
  activityLabels: {
    "pm/ongoing": "Activity::Ongoing",
    "pm/publication": "Activity::Publication",
    "pm/filiere": "Activity::Filiere",
    "pm/prospection": "Activity::Prospection",
  },
  projectRegistry: {},
  membersPage: "GitLab/Project Members",
  repositoriesPage: "GitLab/Active Repositories",
  wikiPagesPage: "GitLab/Wiki Pages",
  rootGroupId: "",
  repositoryPathPrefix: "",
  sourceBaseUrl: "",
};

/** A task selected for pushing to GitLab */
export interface PushTask {
  /** Clean task title (attributes and tags stripped) */
  text: string;
  /** Tags on the task (without #) */
  tags: string[];
  page: string;
  /** Character offset of the task in the page */
  pos: number;
  projectId?: string;
  assignees?: string[];
  dueDate?: string;
  milestoneTag?: string;
  wpTag?: string;
}

/** A previously synced task that may need completing */
export interface SyncedTask {
  page: string;
  pos: number;
  issueIid: number;
  issueUrl: string;
  projectPath: string;
}

export interface GitLabIssue {
  id: number;
  iid: number;
  title: string;
  web_url: string;
  state: string;
  labels: string[];
}

export interface GitLabProject {
  id: number;
  name: string;
  name_with_namespace: string;
  path_with_namespace: string;
  web_url: string;
  description: string | null;
  last_activity_at: string;
  default_branch: string;
  archived: boolean;
}

export interface GitLabMember {
  id: number;
  username: string;
  name: string;
  state: string;
  avatar_url: string;
  web_url: string;
  access_level: number;
  created_at: string;
  last_activity_on: string | null;
}

export interface GitLabMilestone {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string | null;
  state: string;
  due_date: string | null;
  start_date: string | null;
  web_url: string;
}

export interface GitLabGroup {
  id: number;
  name: string;
  full_path: string;
  web_url: string;
}

export interface WikiUrl {
  type: "group" | "project";
  namespace: string;
  url: string;
}
