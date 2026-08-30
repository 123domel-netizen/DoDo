import { ScheduleDashboardWorksSection } from "@/components/dashboard/ScheduleDashboardWorkRow";
import { AttendanceDashboardSection } from "@/components/dashboard/AttendanceDashboardSection";
import { NotebookDashboardSection } from "@/components/dashboard/NotebookDashboardSection";

export function MobileDashboard({
  onOpenSchedules,
  onOpenAttendance,
  onAddAttendance,
  onOpenNotebook,
}: {
  onOpenSchedules?: () => void;
  onOpenAttendance?: () => void;
  onAddAttendance?: (workDate: string) => void;
  onOpenNotebook?: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto thin-scrollbar">
        <ScheduleDashboardWorksSection onOpenSchedules={onOpenSchedules} />
        <AttendanceDashboardSection
          onOpenAttendance={onOpenAttendance}
          onAddAttendance={onAddAttendance}
        />
        <NotebookDashboardSection layout="mobile" onOpenNotebook={onOpenNotebook} />
      </div>
    </div>
  );
}
