import { normalizeSearchText } from "./normalize";
import type { PreviewProject } from "./types";
import { projectLabel } from "./types";

export type ProjectSearchHit = {
  project: PreviewProject;
  rank: number;
};

/**
 * Rank:
 * 1 exact number
 * 2 number starts with query
 * 3 name starts with query
 * 4 name contains query
 */
export function searchProjects(
  projects: PreviewProject[],
  query: string,
): ProjectSearchHit[] {
  const q = normalizeSearchText(query);
  if (!q) {
    return projects
      .slice()
      .sort((a, b) => a.number - b.number)
      .map((project) => ({ project, rank: 99 }));
  }

  const hits: ProjectSearchHit[] = [];
  for (const project of projects) {
    const num = String(project.number);
    const nameN = normalizeSearchText(project.name);
    const labelN = normalizeSearchText(projectLabel(project));
    let rank: number | null = null;
    if (num === q) rank = 1;
    else if (num.startsWith(q)) rank = 2;
    else if (nameN.startsWith(q) || labelN.startsWith(q.replace(/^#/, ""))) rank = 3;
    else if (nameN.includes(q) || labelN.includes(q)) rank = 4;
    if (rank != null) hits.push({ project, rank });
  }

  hits.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.project.number - b.project.number;
  });
  return hits;
}

export function isProjectVisibleTo(
  project: PreviewProject,
  userId: string,
): boolean {
  return project.adminUserId === userId || project.memberIds.includes(userId);
}

export function visibleProjects(
  projects: PreviewProject[],
  userId: string,
): PreviewProject[] {
  return projects.filter((p) => isProjectVisibleTo(p, userId));
}
