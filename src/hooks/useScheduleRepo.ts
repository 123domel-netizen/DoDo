import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { isSchedulesModuleEnabled } from "@/lib/schedules/enabled";
import { getScheduleRepository } from "@/lib/schedules/getScheduleRepository";
import type { ScheduleRepository } from "@/lib/schedules/scheduleRepositoryPort";
import type { PreviewUser } from "@/lib/projectsPreview/types";
import {
  noteScheduleOrgChange,
  runScheduleReload,
  scheduleDebouncedScheduleReload,
} from "@/lib/schedules/scheduleReloadGate";

/** Subscribe to schedule repo commits and force a re-render. */
export function useScheduleRepo(): ScheduleRepository {
  const activeOrgId = useStore((s) => s.activeOrgId);
  const authUserId = useStore((s) => s.authUserId);
  const authUserEmail = useStore((s) => s.authUserEmail);
  const teamMembers = useStore((s) => s.teamMembers);
  const profileName = useChatStore((s) =>
    authUserId ? s.profiles[authUserId]?.displayName ?? null : null,
  );

  const repo = getScheduleRepository({
    orgId: activeOrgId,
    userId: authUserId,
  });

  const [, setTick] = useState(0);

  useEffect(() => {
    return repo.subscribe(() => setTick((n) => n + 1));
  }, [repo]);

  // Cloud: debounce focus/visibility, cooldown 60 min, cross-tab — nie pełny reload na każdy fokus.
  useEffect(() => {
    if (repo.mode !== "cloud" || !repo.reload || !activeOrgId) return;
    noteScheduleOrgChange(activeOrgId);

    const doReload = () => repo.reload!();

    // Natychmiast po zmianie org (gate ma lastSuccessful=0).
    void runScheduleReload(activeOrgId, "org-change", doReload);

    const onVis = () => {
      if (document.visibilityState === "visible") {
        scheduleDebouncedScheduleReload(activeOrgId, "visibility", doReload);
      }
    };
    const onFocus = () => {
      scheduleDebouncedScheduleReload(activeOrgId, "focus", doReload);
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
    };
  }, [repo, activeOrgId]);

  useEffect(() => {
    if (repo.mode !== "local" || !repo.setIdentity) return;
    const userId = authUserId?.trim() || "local-user";
    const displayName =
      profileName?.trim() ||
      authUserEmail?.split("@")[0]?.trim() ||
      "Ty";
    const roster: PreviewUser[] = [];
    const seen = new Set<string>();
    for (const m of teamMembers) {
      const id = m.memberUserId?.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      roster.push({
        id,
        displayName: m.displayName?.trim() || m.email || "Członek",
      });
    }
    repo.setIdentity({
      userId,
      displayName,
      orgId: activeOrgId,
      users: roster,
    });
  }, [
    repo,
    authUserId,
    authUserEmail,
    profileName,
    activeOrgId,
    teamMembers,
  ]);

  return repo;
}

/** @deprecated Use useScheduleRepo */
export function useProjectsPreviewRepo(): ScheduleRepository {
  return useScheduleRepo();
}

export function useSchedulesAvailable(): boolean {
  return isSchedulesModuleEnabled();
}
