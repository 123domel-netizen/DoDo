import { useEffect, useMemo, useState } from "react";
import {
  collectScheduleDashboardHints,
  type ScheduleDashboardHint,
} from "@/lib/projectsPreview/dashboardScheduleHints";
import { getProjectsPreviewRepo } from "@/lib/projectsPreview/repository";
import { isSchedulesModuleEnabled } from "@/lib/schedules/enabled";
import { getScheduleRepository } from "@/lib/schedules/getScheduleRepository";
import { todayIso } from "@/lib/projectsPreview/projectMetrics";
import { useStore } from "@/state/store";
import { cloudEnabled, supabase } from "@/lib/supabase";

export function useScheduleDashboardHints(opts: {
  maxToday?: number;
  maxUpcoming?: number;
}): { today: ScheduleDashboardHint[]; upcoming: ScheduleDashboardHint[] } {
  const activeOrgId = useStore((s) => s.activeOrgId ?? s.myOrgs[0]?.id ?? null);
  const authUserId = useStore((s) => s.authUserId);

  const enabled = isSchedulesModuleEnabled();
  const useCloud = Boolean(cloudEnabled && activeOrgId && authUserId);
  const [tick, setTick] = useState(0);
  const [cloudHints, setCloudHints] = useState<{
    today: ScheduleDashboardHint[];
    upcoming: ScheduleDashboardHint[];
  }>({ today: [], upcoming: [] });

  useEffect(() => {
    if (!enabled) return;
    const repo = getScheduleRepository({
      orgId: activeOrgId,
      userId: authUserId,
    });
    return repo.subscribe(() => setTick((n) => n + 1));
  }, [enabled, activeOrgId, authUserId]);

  useEffect(() => {
    if (!enabled || !useCloud || !supabase || !activeOrgId) {
      setCloudHints({ today: [], upcoming: [] });
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc("schedule_dashboard_hints", {
        p_org_id: activeOrgId,
        p_from: todayIso(),
        p_limit: 80,
      });
      if (cancelled || error || !data) return;
      const rows = data as Array<{
        event_id: string;
        project_id: string;
        project_number: string;
        project_name: string;
        kind: string;
        title: string;
        event_date: string;
      }>;
      const hints: ScheduleDashboardHint[] = rows.map((r) => ({
        id: r.event_id,
        projectId: r.project_id,
        projectNumber: r.project_number,
        projectName: r.project_name,
        projectLabel: `#${r.project_number} ${r.project_name}`,
        kind: r.kind as ScheduleDashboardHint["kind"],
        title: r.title,
        date: r.event_date,
      }));
      const today = todayIso();
      setCloudHints({
        today: hints.filter((h) => h.date === today).slice(0, opts.maxToday ?? 5),
        upcoming: hints
          .filter((h) => h.date > today)
          .slice(0, opts.maxUpcoming ?? 5),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, useCloud, activeOrgId, tick, opts.maxToday, opts.maxUpcoming]);

  return useMemo(() => {
    if (!enabled) return { today: [], upcoming: [] };
    if (useCloud) return cloudHints;
    return collectScheduleDashboardHints(getProjectsPreviewRepo().getState(), {
      maxToday: opts.maxToday,
      maxUpcoming: opts.maxUpcoming,
    });
  }, [enabled, useCloud, cloudHints, opts.maxToday, opts.maxUpcoming, tick]);
}
