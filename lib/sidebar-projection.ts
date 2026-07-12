import type { HerdrAgentRuntimeStatus, SessionRuntimeStatus } from "./runtime-status/types.ts";
import type { SessionInfo } from "./types.ts";

export interface SidebarSessionTreeNode {
  session: SessionInfo;
  children: SidebarSessionTreeNode[];
}

export type SidebarSectionKey = "attention" | "active" | "recent";

export interface SidebarSessionSection {
  key: SidebarSectionKey;
  label: string;
  nodes: SidebarSessionTreeNode[];
  sessionCount: number;
}

export interface SidebarProjection {
  sections: SidebarSessionSection[];
  runtimeDiagnostics: HerdrAgentRuntimeStatus[];
}

const SECTION_LABELS: Record<SidebarSectionKey, string> = {
  attention: "Needs attention",
  active: "Active",
  recent: "Recent",
};

const SECTION_PRIORITY: Record<SidebarSectionKey, number> = {
  recent: 0,
  active: 1,
  attention: 2,
};

export function getRuntimeDiagnosticLabel(agent: HerdrAgentRuntimeStatus): string {
  return agent.linked ? "Stale binding" : "Unbound runtime";
}

export function getSessionActivityLabel(
  status: SessionRuntimeStatus | undefined,
  isUnread = false,
): string | null {
  if (status?.status === "blocked") return "Needs input";
  if (status?.status === "working") return "Working";
  if (isUnread) return "New activity";
  return null;
}

export function buildSidebarProjection(input: {
  sessions: SessionInfo[];
  statuses: Map<string, SessionRuntimeStatus>;
  agents: HerdrAgentRuntimeStatus[];
  selectedCwd: string | null;
}): SidebarProjection {
  const roots = buildSessionTree(input.sessions);
  const grouped = new Map<SidebarSectionKey, SidebarSessionTreeNode[]>([
    ["attention", []],
    ["active", []],
    ["recent", []],
  ]);

  for (const root of roots) {
    grouped.get(sectionForTree(root, input.statuses))!.push(root);
  }

  const sections = (["attention", "active", "recent"] as const)
    .map((key): SidebarSessionSection => {
      const nodes = grouped.get(key)!;
      return {
        key,
        label: SECTION_LABELS[key],
        nodes,
        sessionCount: nodes.reduce((count, node) => count + countTreeSessions(node), 0),
      };
    })
    .filter((section) => section.nodes.length > 0);

  const displayedSessionIds = new Set(input.sessions.map((session) => session.id));
  const representedAgentIds = new Set(
    [...input.statuses.values()]
      .filter((status) => displayedSessionIds.has(status.sessionId))
      .map((status) => status.herdrAgentId)
      .filter((id): id is string => Boolean(id)),
  );
  const runtimeDiagnostics = input.selectedCwd
    ? input.agents.filter((agent) => {
        if (agent.status === "done" || representedAgentIds.has(agent.id)) return false;
        return agent.cwd === input.selectedCwd;
      })
    : [];

  return { sections, runtimeDiagnostics };
}

function buildSessionTree(sessions: SessionInfo[]): SidebarSessionTreeNode[] {
  const byId = new Map<string, SidebarSessionTreeNode>();
  for (const session of sessions) {
    byId.set(session.id, { session, children: [] });
  }

  const parentOf = new Map<string, string>();
  for (const session of sessions) {
    if (session.parentSessionId) parentOf.set(session.id, session.parentSessionId);
  }

  const resolveAncestor = (id: string): string | null => {
    let current = parentOf.get(id);
    const visited = new Set<string>();
    while (current) {
      if (visited.has(current)) return null;
      visited.add(current);
      if (byId.has(current)) return current;
      current = parentOf.get(current);
    }
    return null;
  };

  const roots: SidebarSessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) byId.get(ancestor)!.children.push(node);
    else roots.push(node);
  }

  const sortByModified = (nodes: SidebarSessionTreeNode[]): void => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((node) => sortByModified(node.children));
  };
  sortByModified(roots);
  return roots;
}

function sectionForTree(
  node: SidebarSessionTreeNode,
  statuses: Map<string, SessionRuntimeStatus>,
): SidebarSectionKey {
  let section = sectionForStatus(statuses.get(node.session.id));
  for (const child of node.children) {
    const childSection = sectionForTree(child, statuses);
    if (SECTION_PRIORITY[childSection] > SECTION_PRIORITY[section]) section = childSection;
  }
  return section;
}

function sectionForStatus(status: SessionRuntimeStatus | undefined): SidebarSectionKey {
  if (status?.status === "blocked") return "attention";
  if (status?.status === "working") return "active";
  return "recent";
}

function countTreeSessions(node: SidebarSessionTreeNode): number {
  return 1 + node.children.reduce((count, child) => count + countTreeSessions(child), 0);
}
