import { useEffect, useState } from "react";
import {
  getProjectsPreviewRepo,
  type ProjectsPreviewRepository,
} from "@/lib/projectsPreview/repository";

/** Subscribe to preview repo commits and force a re-render. */
export function useProjectsPreviewRepo(): ProjectsPreviewRepository {
  const repo = getProjectsPreviewRepo();
  const [, setTick] = useState(0);

  useEffect(() => {
    return repo.subscribe(() => setTick((n) => n + 1));
  }, [repo]);

  return repo;
}
