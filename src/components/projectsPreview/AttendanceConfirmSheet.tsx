import { useMemo, useState, type ReactNode } from "react";
import { Check, ClipboardList, Pencil, Wrench, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  EQUIPMENT_PRESET_LABEL,
  isEquipmentPresetKey,
} from "@/lib/projectsPreview/equipmentPresets";
import {
  shiftHours,
  totalLaborHours,
} from "@/lib/projectsPreview/workerShifts";
import {
  projectLabel,
  type CrewAttendance,
  type CrewEquipmentLog,
  type PreviewCrew,
  type PreviewProject,
} from "@/lib/projectsPreview/types";

interface AttendanceConfirmSheetProps {
  crewLabel: string;
  workDate: string;
  rows: CrewAttendance[];
  equipment: CrewEquipmentLog[];
  crews: PreviewCrew[];
  projects: PreviewProject[];
  onClose: () => void;
  onSaveNote: (id: string, note: string) => void;
  onSetStatus: (status: "declared" | "confirmed") => void;
  onEdit?: (row: CrewAttendance) => void;
}

function formatPlDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function formatRh(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/** Read-only attendance summary + confirm / unconfirm status. */
export function AttendanceConfirmSheet({
  crewLabel,
  workDate,
  rows,
  equipment,
  crews,
  projects,
  onClose,
  onSaveNote,
  onSetStatus,
  onEdit,
}: AttendanceConfirmSheetProps) {
  const crewById = useMemo(
    () => new Map(crews.map((c) => [c.id, c])),
    [crews],
  );
  const projectById = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects],
  );
  const equipmentByAttendance = useMemo(() => {
    const map = new Map<string, CrewEquipmentLog[]>();
    for (const e of equipment) {
      const list = map.get(e.attendanceId) ?? [];
      list.push(e);
      map.set(e.attendanceId, list);
    }
    return map;
  }, [equipment]);

  const [noteDrafts, setNoteDrafts] = useState(() =>
    Object.fromEntries(rows.map((r) => [r.id, r.note ?? ""])),
  );

  const allConfirmed =
    rows.length > 0 && rows.every((r) => r.status === "confirmed");

  const persistNotes = () => {
    for (const row of rows) {
      const next = (noteDrafts[row.id] ?? "").trim();
      if (next !== (row.note ?? "").trim()) {
        onSaveNote(row.id, next);
      }
    }
  };

  const setStatus = (status: "declared" | "confirmed") => {
    persistNotes();
    onSetStatus(status);
  };

  return createPortal(
    <div className="fixed inset-0 z-[9200] flex items-end justify-center bg-black/50 sm:items-center sm:px-4">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[90vh] w-full overflow-y-auto thin-scrollbar rounded-t-2xl border border-line bg-surface-overlay p-4 shadow-pop sm:max-w-md sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink">
            <ClipboardList size={14} className="shrink-0 text-accent" />
            <span className="truncate">Obecność — {crewLabel}</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={18} />
          </button>
        </div>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-faint">
            Brak oświadczeń na ten dzień.
          </p>
        ) : (
          <div className="space-y-3">
            <InfoField label="Dzień">
              <p className="rounded-lg border border-line/60 bg-surface-raised/40 px-3 py-2 text-sm text-ink">
                {formatPlDate(workDate)}
              </p>
            </InfoField>

            {rows.map((row) => {
              const crew = crewById.get(row.crewId);
              const project = projectById.get(row.projectId);
              const logs = equipmentByAttendance.get(row.id) ?? [];
              const workers = row.workers ?? [];
              const rh =
                workers.length > 0
                  ? totalLaborHours(workers)
                  : row.laborHours;
              const note = noteDrafts[row.id] ?? "";

              return (
                <div
                  key={row.id}
                  className="space-y-2.5 border-t border-line/50 pt-3 first:border-t-0 first:pt-0"
                >
                  {rows.length > 1 ? (
                    <p className="text-[11px] font-semibold text-ink-light">
                      {project ? projectLabel(project) : "Budowa"}
                    </p>
                  ) : null}

                  <InfoField label="Brygada">
                    <div className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface-raised/40 px-3 py-2 text-sm text-ink">
                      {crew ? (
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: crew.color }}
                          aria-hidden
                        />
                      ) : null}
                      <span className="truncate">
                        {crew?.name ?? crewLabel}
                        {crew?.company ? (
                          <span className="text-ink-faint">
                            {" "}
                            · {crew.company}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </InfoField>

                  <InfoField label="Budowa">
                    <p className="rounded-lg border border-line/60 bg-surface-raised/40 px-3 py-2 text-sm text-ink">
                      {project ? projectLabel(project) : "—"}
                    </p>
                  </InfoField>

                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                        Osoby na budowie
                      </p>
                      <p className="text-[11px] text-ink-faint">
                        {row.headcount} os. · {formatRh(rh)} RH
                      </p>
                    </div>
                    {workers.length === 0 ? (
                      <p className="rounded-lg border border-line/50 bg-surface-raised/20 px-3 py-2 text-[12px] text-ink-faint">
                        {row.headcount} os. · {formatRh(row.laborHours)} RH
                        (bez rozbicia na godziny)
                      </p>
                    ) : (
                      <ul className="divide-y divide-line/50 overflow-hidden rounded-lg border border-line/70">
                        {workers.map((w, index) => (
                          <li
                            key={w.id}
                            className="flex items-center gap-2 bg-surface-raised/30 px-2.5 py-1.5 text-[12px]"
                          >
                            <span className="w-4 shrink-0 text-center font-semibold tabular-nums text-ink-faint">
                              {index + 1}
                            </span>
                            <span className="font-semibold tabular-nums text-ink">
                              {w.startTime}
                            </span>
                            <span className="text-ink-faint">→</span>
                            <span className="font-semibold tabular-nums text-ink">
                              {w.endTime}
                            </span>
                            <span className="ml-auto tabular-nums text-ink-faint">
                              {formatRh(shiftHours(w.startTime, w.endTime))}h
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                      Sprzęt ciężki
                    </p>
                    {logs.length === 0 ? (
                      <p className="text-[12px] text-ink-faint">Brak sprzętu.</p>
                    ) : (
                      <ul className="divide-y divide-line/50 overflow-hidden rounded-lg border border-line/70">
                        {logs.map((e) => (
                          <li
                            key={e.id}
                            className="flex items-center gap-2 bg-surface-raised/30 px-2.5 py-1.5 text-[12px] text-ink"
                          >
                            <Wrench
                              size={12}
                              className="shrink-0 text-ink-faint"
                            />
                            <span className="min-w-0 flex-1 truncate">
                              {e.equipmentLabel ||
                                (isEquipmentPresetKey(e.equipmentKey)
                                  ? EQUIPMENT_PRESET_LABEL[e.equipmentKey]
                                  : e.equipmentKey)}
                            </span>
                            <span className="shrink-0 tabular-nums text-ink-faint">
                              {e.quantity}× · {formatRh(e.hours)}h
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <InfoField label="Notatka (opcjonalnie)">
                    <textarea
                      value={note}
                      onChange={(e) =>
                        setNoteDrafts((prev) => ({
                          ...prev,
                          [row.id]: e.target.value,
                        }))
                      }
                      rows={2}
                      className="w-full resize-none rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                      placeholder="Opcjonalnie…"
                    />
                  </InfoField>

                  {onEdit ? (
                    <button
                      type="button"
                      onClick={() => {
                        persistNotes();
                        onEdit(row);
                      }}
                      className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent hover:underline"
                    >
                      <Pencil size={12} />
                      Edytuj oświadczenie
                    </button>
                  ) : null}
                </div>
              );
            })}

            <div className="space-y-1.5 border-t border-line/60 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                Status
              </p>
              <div
                className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-surface-raised/60 p-1"
                role="group"
                aria-label="Status potwierdzenia"
              >
                <button
                  type="button"
                  onClick={() => setStatus("confirmed")}
                  className={`inline-flex items-center justify-center gap-1 rounded-md px-3 py-2 text-[12px] font-semibold transition ${
                    allConfirmed
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "text-ink-faint hover:bg-surface-overlay hover:text-ink"
                  }`}
                >
                  <Check size={13} />
                  Potwierdzam
                </button>
                <button
                  type="button"
                  onClick={() => setStatus("declared")}
                  className={`inline-flex items-center justify-center gap-1 rounded-md px-3 py-2 text-[12px] font-semibold transition ${
                    !allConfirmed
                      ? "bg-surface-overlay text-ink"
                      : "text-ink-faint hover:bg-surface-overlay hover:text-ink"
                  }`}
                >
                  Nie potwierdzam
                </button>
              </div>
              <p className="text-[11px] text-ink-faint">
                {allConfirmed
                  ? "Oświadczenie jest potwierdzone."
                  : "Oświadczenie zapisane — jeszcze niepotwierdzone."}
              </p>
            </div>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2 border-t border-line/60 pt-3">
          <button
            type="button"
            onClick={() => {
              persistNotes();
              onClose();
            }}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
          >
            Gotowe
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function InfoField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </p>
      {children}
    </div>
  );
}
