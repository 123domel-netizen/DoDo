import { useEffect, useMemo, useState } from "react";
import {
  collectScheduleDashboardFeed,
  type ScheduleDashboardFeedItem,
} from "@/lib/projectsPreview/dashboardScheduleWorks";
import { getProjectsPreviewRepo } from "@/lib/projectsPreview/repository";
import { isSchedulesModuleEnabled } from "@/lib/schedules/enabled";
import { getScheduleRepository } from "@/lib/schedules/getScheduleRepository";
import { useStore } from "@/state/store";
import { cloudEnabled } from "@/lib/supabase";

export function useScheduleDashboardWorks(opts?: {
  soonDays?: number;
  minUpcoming?: number;
}): {
  inProgress: ScheduleDashboardFeedItem[];
  startingSoon: ScheduleDashboardFeedItem[];
} {
  const activeOrgId = useStore((s) => s.activeOrgId ?? s.myOrgs[0]?.id ?? null);
  const authUserId = useStore((s) => s.authUserId);
  const enabled = isSchedulesModuleEnabled();
  const useCloud = Boolean(cloudEnabled && activeOrgId && authUserId);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const repo = getScheduleRepository({
      orgId: activeOrgId,
      userId: authUserId,
    });
    return repo.subscribe(() => setTick((n) => n + 1));
  }, [enabled, activeOrgId, authUserId]);

  return useMemo(() => {
    if (!enabled) return { inProgress: [], startingSoon: [] };
    const state = useCloud
      ? getScheduleRepository({
          orgId: activeOrgId,
          userId: authUserId,
        }).getState()
      : getProjectsPreviewRepo().getState();
    return collectScheduleDashboardFeed(state, {
      soonDays: opts?.soonDays,
      minUpcoming: opts?.minUpcoming,
    });
  }, [
    enabled,
    useCloud,
    activeOrgId,
    authUserId,
    opts?.soonDays,
    opts?.minUpcoming,
    tick,
  ]);
}
