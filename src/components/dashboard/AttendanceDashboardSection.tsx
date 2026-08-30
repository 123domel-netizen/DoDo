import { useEffect, useState } from "react";
import { isSameDay } from "date-fns";
import { ClipboardCheck, Plus } from "lucide-react";
import { fmt } from "@/lib/format";
import {
  formatEquipmentSummary,
  isoToLocalDate,
  type AttendanceDashboardCompanyRow,
} from "@/lib/attendanceDashboard";
import { useAttendanceDashboardWeek } from "@/hooks/useAttendanceDashboardToday";
import { DASHBOARD_LEAD_COL } from "@/components/dashboard/dashboardRowLayout";
import { MobileSectionToggle } from "@/components/mobile/dashboard/MobileSectionToggle";
import { useMobileSectionExpanded } from "@/components/mobile/dashboard/sectionCollapse";
import { AttendanceConfirmSheet } from "@/components/projectsPreview/AttendanceConfirmSheet";

const COLLAPSED_PREVIEW = 4;
const ROW_ACCENT = "#6b8cce";

const sectionTitleBtn =
  "inline-flex min-w-0 max-w-full shrink items-center truncate rounded-md border border-line bg-surface-raised/60 px-2 py-1 text-left text-sm font-medium uppercase tracking-wide text-ink-light transition hover:border-line-strong hover:bg-surface-overlay hover:text-ink active:bg-surface-overlay";

function AttendanceCompanyRow({
  row,
  onOpen,
}: {
  row: AttendanceDashboardCompanyRow;
  onOpen: () => void;
}) {
  const equipment = formatEquipmentSummary(row);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full min-w-0 items-center gap-1.5 rounded-md border border-line/50 bg-surface-raised/30 px-1.5 py-0.5 text-left transition hover:bg-surface-overlay"
      style={{ borderLeft: `3px solid ${ROW_ACCENT}` }}
    >
      <div
        className={`${DASHBOARD_LEAD_COL} shrink-0 text-[10px] font-medium tabular-nums leading-none text-ink-light`}
      >
        <span>{row.headcount}</span>
        <span className="text-[9px] text-ink-faint"> os.</span>
      </div>
      <p className="min-w-0 flex-1 truncate text-[13px] leading-tight">
        <span className="font-medium text-ink">{row.companyLabel}</span>
        <span className="text-[10px] font-normal text-ink-faint">
          {equipment ? ` · ${equipment}` : " · brak sprzętu"}
        </span>
      </p>
    </button>
  );
}

function AttendanceWeekStrip({
  weekActivity,
  today,
  selectedDate,
  onSelectDate,
}: {
  weekActivity: { date: string; count: number }[];
  today: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const todayDate = isoToLocalDate(today);

  return (
    <div className="-mx-1 mb-2 flex px-0.5 py-0.5">
      {weekActivity.map(({ date, count }) => {
        const day = isoToLocalDate(date);
        const isToday = isSameDay(day, todayDate);
        const isSelected = date === selectedDate;
        const busy = count > 0;
        return (
          <button
            key={date}
            type="button"
            onClick={() => onSelectDate(date)}
            className="flex min-w-0 flex-1 flex-col items-center gap-px rounded-md py-0.5 transition hover:bg-surface-overlay"
            aria-label={`${fmt(day, "EEEE d MMMM")}${busy ? `, ${count} firm` : ", brak wpisów"}`}
            aria-pressed={isSelected}
          >
            <span className="text-[9px] font-medium uppercase tracking-wide text-ink-faint">
              {fmt(day, "EEE")}
            </span>
            <span
              className={`flex h-6 w-6 items-center justify-center text-[11px] font-semibold tabular-nums ${
                isSelected
                  ? "rounded-full bg-accent text-white shadow-glow"
                  : isToday
                    ? "rounded-full ring-2 ring-accent/50 text-ink"
                    : "text-ink"
              }`}
            >
              {fmt(day, "d")}
            </span>
            <span
              className={`mt-px h-1 w-1 rounded-full ${busy ? "bg-accent" : "bg-transparent"}`}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}

export function AttendanceDashboardSection({
  onOpenAttendance,
  onAddAttendance,
}: {
  onOpenAttendance?: () => void;
  onAddAttendance?: (workDate: string) => void;
} = {}) {
  const {
    today,
    weekActivity,
    daySection,
    totalHeadcount,
    isEmpty,
    crews,
    projects,
    previewForCompany,
  } = useAttendanceDashboardWeek();
  const [selectedDate, setSelectedDate] = useState(today);
  const [companyPreview, setCompanyPreview] = useState<{
    date: string;
    companyKey: string;
    companyLabel: string;
  } | null>(null);
  const [expanded, toggleExpanded] = useMobileSectionExpanded(
    "attendance",
    false,
  );

  useEffect(() => {
    setSelectedDate(today);
  }, [today]);

  const section = daySection(selectedDate);
  const visibleRows = expanded
    ? section.rows
    : section.rows.slice(0, COLLAPSED_PREVIEW);
  const hiddenRowCount = Math.max(0, section.rows.length - visibleRows.length);
  const showStrip = expanded || !isEmpty;
  const previewData = companyPreview
    ? previewForCompany(companyPreview.date, companyPreview.companyKey)
    : null;
  const previewSubLabel =
    previewData && previewData.crewLabels.length > 1
      ? `Brygady: ${previewData.crewLabels.join(" · ")}`
      : previewData?.crewLabels[0]
        ? `Brygada: ${previewData.crewLabels[0]}`
        : undefined;

  return (
    <section className="border-b border-line p-3">
      <div
        className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-faint ${
          isEmpty && !expanded && !showStrip ? "mb-0" : "mb-1.5"
        }`}
      >
        <ClipboardCheck size={14} className="shrink-0" />
        {onOpenAttendance ? (
          <button
            type="button"
            onClick={onOpenAttendance}
            className={sectionTitleBtn}
            title="Otwórz obecności"
          >
            Obecności
          </button>
        ) : (
          <span className="min-w-0 truncate text-sm font-medium uppercase tracking-wide text-ink-light">
            Obecności
          </span>
        )}
        <span className="min-w-0 flex-1" aria-hidden />
        {isEmpty && !expanded ? (
          <span className="text-[10px] font-normal normal-case tracking-normal text-ink-faint">
            Brak
          </span>
        ) : null}
        {!isEmpty && !expanded ? (
          <span className="rounded-full bg-surface-overlay px-1.5 py-px text-[10px] font-semibold tabular-nums normal-case tracking-normal text-ink-light">
            {totalHeadcount} os.
          </span>
        ) : null}
        {!expanded && hiddenRowCount > 0 ? (
          <span className="rounded-full bg-surface-overlay px-1.5 py-px text-[10px] font-semibold tabular-nums normal-case tracking-normal text-ink-light">
            +{hiddenRowCount}
          </span>
        ) : null}
        {onAddAttendance ? (
          <button
            type="button"
            onClick={() => onAddAttendance(selectedDate)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-grad px-2 py-1 text-[10px] font-semibold normal-case tracking-normal text-white shadow-glow transition hover:brightness-110"
          >
            <Plus size={12} strokeWidth={2.5} />
            Dodaj
          </button>
        ) : null}
        <MobileSectionToggle expanded={expanded} onToggle={toggleExpanded} />
      </div>

      {showStrip ? (
        <AttendanceWeekStrip
          weekActivity={weekActivity}
          today={today}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      ) : null}

      {section.rows.length > 0 ? (
        <div>
          <div
            className={`mb-1 flex items-baseline gap-2 ${
              selectedDate === today ? "text-accent" : "text-ink-faint"
            }`}
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide">
              {fmt(section.dateObj, "EEEE")}
            </span>
            <span className="text-[11px] font-medium tabular-nums">
              {fmt(section.dateObj, "d MMM")}
            </span>
            <span className="ml-auto text-[10px] font-medium tabular-nums normal-case tracking-normal">
              {section.totalHeadcount} os.
              {section.totalEquipmentQty > 0
                ? ` · ${section.totalEquipmentQty} szt.`
                : ""}
            </span>
          </div>
          <div className="space-y-0.5">
            {visibleRows.map((row) => (
              <AttendanceCompanyRow
                key={row.companyKey}
                row={row}
                onOpen={() =>
                  setCompanyPreview({
                    date: selectedDate,
                    companyKey: row.companyKey,
                    companyLabel: row.companyLabel,
                  })
                }
              />
            ))}
          </div>
        </div>
      ) : showStrip ? (
        <p className="py-1 text-center text-[11px] text-ink-faint">
          Brak wpisów w tym dniu.
        </p>
      ) : null}

      {isEmpty && expanded ? (
        <div className="py-2 text-center">
          <p className="text-[12px] text-ink-faint">
            Brak wpisów w tym tygodniu
          </p>
          {onAddAttendance ? (
            <button
              type="button"
              onClick={() => onAddAttendance(selectedDate)}
              className="mt-1 text-[11px] font-medium text-accent transition hover:brightness-110"
            >
              Dodaj obecność
            </button>
          ) : null}
        </div>
      ) : null}

      {companyPreview && previewData ? (
        <AttendanceConfirmSheet
          crewLabel={companyPreview.companyLabel}
          workDate={companyPreview.date}
          rows={previewData.rows}
          equipment={previewData.equipment}
          crews={crews}
          projects={projects}
          readOnly
          groupLabel="Firma"
          subLabel={previewSubLabel}
          onClose={() => setCompanyPreview(null)}
          onSaveNote={() => {}}
          onSetStatus={() => {}}
        />
      ) : null}
    </section>
  );
}
