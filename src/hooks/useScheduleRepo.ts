import { useEffect, useState } from "react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { isSchedulesModuleEnabled } from "@/lib/schedules/enabled";
import { getScheduleRepository } from "@/lib/schedules/getScheduleRepository";
import type { ScheduleRepository } from "@/lib/schedules/scheduleRepositoryPort";
import type { PreviewUser } from "@/lib/projectsPreview/types";

/** Subscribe to schedule repo commits and force a re-render. */
export function useScheduleRepo(): ScheduleRepository {
  const activeOrgId = useStore((s) => s.activeOrgId);
  const authUserId = useStore((s) => s.authUserId);
  const authUserEmail = useStore((s) => s.authUserEmail);
  const teamMembers = useStore((s) => s.teamMembers);
  const schedulesEnabled = useStore((s) => {
    const orgId = s.activeOrgId ?? s.myOrgs[0]?.id;
    const org = s.myOrgs.find((o) => o.id === orgId);
    return org?.schedulesEnabled ?? false;
  });
  const profileName = useChatStore((s) =>
    authUserId ? s.profiles[authUserId]?.displayName ?? null : null,
  );

  const repo = getScheduleRepository({
    orgId: activeOrgId,
    schedulesEnabled,
    userId: authUserId,
  });

  const [, setTick] = useState(0);

  useEffect(() => {
    return repo.subscribe(() => setTick((n) => n + 1));
  }, [repo]);

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
  const schedulesEnabled = useStore((s) => {
    const orgId = s.activeOrgId ?? s.myOrgs[0]?.id;
    return s.myOrgs.find((o) => o.id === orgId)?.schedulesEnabled ?? false;
  });
  return isSchedulesModuleEnabled(schedulesEnabled);
}
