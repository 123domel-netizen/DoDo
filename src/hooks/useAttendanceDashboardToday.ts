import { useMemo } from "react";
import {
  attendanceDayActivityCount,
  attendanceDaySection,
  attendanceRecordsForCompanyDay,
  attendanceWeekSections,
  buildAttendanceDashboardBoard,
  weekIsoDays,
  type AttendanceDashboardDaySection,
} from "@/lib/attendanceDashboard";
import { todayIso } from "@/lib/projectsPreview/projectMetrics";
import type {
  CrewAttendance,
  CrewEquipmentLog,
  PreviewCrew,
  PreviewProject,
} from "@/lib/projectsPreview/types";
import { useScheduleRepo } from "@/hooks/useScheduleRepo";

export type { AttendanceDashboardCompanyRow } from "@/lib/attendanceDashboard";

export type AttendanceCompanyPreview = {
  rows: CrewAttendance[];
  equipment: CrewEquipmentLog[];
  crewLabels: string[];
};

export function useAttendanceDashboardWeek(): {
  today: string;
  weekDays: string[];
  weekActivity: { date: string; count: number }[];
  sections: AttendanceDashboardDaySection[];
  daySection: (date: string) => AttendanceDashboardDaySection;
  totalHeadcount: number;
  isEmpty: boolean;
  crews: PreviewCrew[];
  projects: PreviewProject[];
  previewForCompany: (date: string, companyKey: string) => AttendanceCompanyPreview;
} {
  const scheduleRepo = useScheduleRepo();
  const state = scheduleRepo.getState();
  const today = todayIso();
  const weekDays = useMemo(() => weekIsoDays(today), [today]);

  return useMemo(() => {
    const board = buildAttendanceDashboardBoard(state, weekDays);
    const sections = attendanceWeekSections(weekDays, board);

    const weekActivity = weekDays.map((date) => ({
      date,
      count: attendanceDayActivityCount(date, board),
    }));

    const totalHeadcount = sections.reduce(
      (sum, section) => sum + section.totalHeadcount,
      0,
    );

    return {
      today,
      weekDays,
      weekActivity,
      sections,
      daySection: (date: string) => attendanceDaySection(date, board),
      totalHeadcount,
      isEmpty: sections.length === 0,
      crews: state.crews,
      projects: state.projects,
      previewForCompany: (date: string, companyKey: string) =>
        attendanceRecordsForCompanyDay(state, date, companyKey),
    };
  }, [
    state.crewAttendance,
    state.crewEquipmentLogs,
    state.crews,
    state.projects,
    weekDays,
    today,
  ]);
}

/** @deprecated Użyj useAttendanceDashboardWeek */
export function useAttendanceDashboardToday() {
  const week = useAttendanceDashboardWeek();
  const todaySection = week.daySection(week.today);
  return {
    today: week.today,
    rows: todaySection.rows,
    totalHeadcount: todaySection.totalHeadcount,
    pendingCount: 0,
  };
}
