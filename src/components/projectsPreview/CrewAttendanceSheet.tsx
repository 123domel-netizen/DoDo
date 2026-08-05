import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ClipboardList, Plus, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { IsoDateInput } from "./IsoDateInput";
import {
  EQUIPMENT_PRESET_KEYS,
  EQUIPMENT_PRESET_LABEL,
  type EquipmentPresetKey,
} from "@/lib/projectsPreview/equipmentPresets";
import { todayIso } from "@/lib/projectsPreview/projectMetrics";
import {
  projectLabel,
  type CrewAttendance,
  type CrewEquipmentLog,
  type PreviewCrew,
  type PreviewProject,
  type ScheduleBlock,
} from "@/lib/projectsPreview/types";
import { splitAttendanceByProject } from "@/lib/projectsPreview/attendanceSplit";
import {
  DEFAULT_WORK_END,
  DEFAULT_WORK_START,
  HALF_HOUR_TIMES,
  defaultShiftTimesFromPrevious,
  findPreviousCompanyAttendance,
  newWorkerShift,
  resolveInitialWorkers,
  shiftHours,
  totalLaborHours,
  type WorkerShiftDraft,
} from "@/lib/projectsPreview/workerShifts";

type EquipmentDraft = {
  key: string;
  id?: string;
  equipmentKey: EquipmentPresetKey;
  equipmentLabel: string;
  quantity: string;
  hours: string;
  /** Empty = default budowa. */
  projectId: string;
};

export type CrewAttendanceSavePayload = {
  crewId: string;
  workDate: string;
  note: string;
  splits: ReturnType<typeof splitAttendanceByProject>;
  previousAttendanceIds: string[];
};

interface CrewAttendanceSheetProps {
  crew: PreviewCrew;
  /** When set, brygada can be switched in the form. */
  crewOptions?: PreviewCrew[];
  crews: PreviewCrew[];
  attendanceHistory: CrewAttendance[];
  projects: PreviewProject[];
  blocks: ScheduleBlock[];
  /** Existing row for crew+project+date if editing. */
  existing?: CrewAttendance | null;
  /** All attendances for this crew+day (multi-budowa). */
  existingBatch?: CrewAttendance[];
  existingEquipment?: CrewEquipmentLog[];
  defaultDate?: string;
  defaultProjectId?: string;
  onClose: () => void;
  onSave: (data: CrewAttendanceSavePayload) => void;
  onDelete?: () => void;
}

function draftKey() {
  return `eq-${Math.random().toString(36).slice(2, 9)}`;
}

function suggestProjectId(
  crewId: string,
  projects: PreviewProject[],
  blocks: ScheduleBlock[],
  today: string,
  preferred?: string,
): string {
  if (preferred && projects.some((p) => p.id === preferred)) return preferred;
  const active = blocks.find(
    (b) =>
      b.role === "work" &&
      b.crewId === crewId &&
      b.startDate <= today &&
      b.endDate >= today &&
      projects.some((p) => p.id === b.projectId),
  );
  if (active) return active.projectId;
  return projects[0]?.id ?? "";
}

function formatRh(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/** Sheet to declare people (per-shift) + heavy equipment for a crew on a build/day. */
export function CrewAttendanceSheet({
  crew: initialCrew,
  crewOptions,
  crews,
  attendanceHistory,
  projects,
  blocks,
  existing,
  existingBatch,
  existingEquipment = [],
  defaultDate,
  defaultProjectId,
  onClose,
  onSave,
  onDelete,
}: CrewAttendanceSheetProps) {
  const today = todayIso();
  const options = crewOptions?.length ? crewOptions : [initialCrew];
  const [crewId, setCrewId] = useState(initialCrew.id);
  const crew = options.find((c) => c.id === crewId) ?? initialCrew;
  const batch = useMemo(() => {
    if (existingBatch && existingBatch.length > 0) return existingBatch;
    return existing ? [existing] : [];
  }, [existing, existingBatch]);
  const [workDate, setWorkDate] = useState(
    batch[0]?.workDate ?? defaultDate ?? today,
  );
  const [projectId, setProjectId] = useState(() => {
    if (defaultProjectId && projects.some((p) => p.id === defaultProjectId)) {
      return defaultProjectId;
    }
    if (existing?.projectId) return existing.projectId;
    if (batch[0]?.projectId) return batch[0].projectId;
    return suggestProjectId(crew.id, projects, blocks, today, defaultProjectId);
  });
  const [workers, setWorkers] = useState<WorkerShiftDraft[]>(() =>
    resolveInitialWorkers({
      existing,
      existingBatch: batch,
      defaultProjectId:
        existing?.projectId ||
        batch[0]?.projectId ||
        defaultProjectId ||
        "",
      crew,
      crews,
      attendance: attendanceHistory,
      workDate: batch[0]?.workDate ?? defaultDate ?? today,
    }),
  );
  const [note, setNote] = useState(
    () => batch.find((b) => b.note)?.note ?? existing?.note ?? "",
  );
  const [lastEditedWorkerId, setLastEditedWorkerId] = useState<string | null>(
    null,
  );
  const attendanceProjectById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of batch) m.set(a.id, a.projectId);
    return m;
  }, [batch]);
  const [equipment, setEquipment] = useState<EquipmentDraft[]>(() =>
    existingEquipment.length
      ? existingEquipment.map((e) => {
          const attProject = attendanceProjectById.get(e.attendanceId);
          const def =
            existing?.projectId ||
            batch[0]?.projectId ||
            defaultProjectId ||
            "";
          const projectId =
            attProject && attProject !== def ? attProject : "";
          return {
            key: e.id,
            id: e.id,
            equipmentKey: (EQUIPMENT_PRESET_KEYS.includes(
              e.equipmentKey as EquipmentPresetKey,
            )
              ? e.equipmentKey
              : "other") as EquipmentPresetKey,
            equipmentLabel: e.equipmentLabel,
            quantity: String(e.quantity),
            hours: String(e.hours),
            projectId,
          };
        })
      : [],
  );

  const projectOptions = useMemo(
    () =>
      projects
        .slice()
        .sort((a, b) =>
          a.number.localeCompare(b.number, undefined, { numeric: true }),
        ),
    [projects],
  );

  const laborTotal = totalLaborHours(workers);
  const timesMixed =
    workers.length > 1 &&
    workers.some(
      (w) =>
        w.startTime !== workers[0]!.startTime ||
        w.endTime !== workers[0]!.endTime,
    );
  const syncSource =
    (lastEditedWorkerId &&
      workers.find((w) => w.id === lastEditedWorkerId)) ||
    workers[0] ||
    null;

  const addWorker = () => {
    const previous = findPreviousCompanyAttendance(
      attendanceHistory,
      crews,
      crew,
      workDate,
      existing?.id,
    );
    const fromRow = workers[0];
    const times = fromRow
      ? { startTime: fromRow.startTime, endTime: fromRow.endTime }
      : defaultShiftTimesFromPrevious(previous);
    setWorkers((prev) => [
      ...prev,
      newWorkerShift(
        times.startTime || DEFAULT_WORK_START,
        times.endTime || DEFAULT_WORK_END,
      ),
    ]);
  };

  const updateWorkerTime = (
    id: string,
    field: "startTime" | "endTime",
    value: string,
  ) => {
    setLastEditedWorkerId(id);
    setWorkers((prev) =>
      prev.map((w) => (w.id === id ? { ...w, [field]: value } : w)),
    );
  };

  const applyTimesToAll = () => {
    if (!syncSource) return;
    setWorkers((prev) =>
      prev.map((w) => ({
        ...w,
        startTime: syncSource.startTime,
        endTime: syncSource.endTime,
      })),
    );
    setLastEditedWorkerId(null);
  };

  const addEquipment = () => {
    setEquipment((prev) => [
      ...prev,
      {
        key: draftKey(),
        equipmentKey: "koparka",
        equipmentLabel: "",
        quantity: "1",
        hours: "8",
        projectId: "",
      },
    ]);
  };

  const submit = () => {
    if (!projectId) {
      alert("Wybierz budowę.");
      return;
    }
    for (const w of workers) {
      if (shiftHours(w.startTime, w.endTime) <= 0) {
        alert("Koniec pracy musi być później niż start (ten sam dzień).");
        return;
      }
    }
    const logs: Array<{
      id?: string;
      equipmentKey: string;
      equipmentLabel: string;
      quantity: number;
      hours: number;
      projectId: string;
    }> = [];
    for (const row of equipment) {
      const qty = Number.parseInt(row.quantity, 10);
      const hrs = Number.parseFloat(row.hours.replace(",", "."));
      if (!Number.isFinite(qty) || qty < 0) {
        alert("Ilość sprzętu musi być liczbą ≥ 0.");
        return;
      }
      if (!Number.isFinite(hrs) || hrs < 0) {
        alert("Godziny sprzętu muszą być liczbą ≥ 0.");
        return;
      }
      if (row.equipmentKey === "other" && !row.equipmentLabel.trim()) {
        alert("Podaj nazwę sprzętu (Inny).");
        return;
      }
      logs.push({
        id: row.id,
        equipmentKey: row.equipmentKey,
        equipmentLabel:
          row.equipmentKey === "other"
            ? row.equipmentLabel.trim()
            : EQUIPMENT_PRESET_LABEL[row.equipmentKey],
        quantity: qty,
        hours: hrs,
        projectId: row.projectId,
      });
    }

    const existingIdByProject: Record<string, string> = {};
    for (const a of batch) {
      existingIdByProject[a.projectId] = a.id;
    }

    const splits = splitAttendanceByProject({
      defaultProjectId: projectId,
      workers,
      equipment: logs,
      existingIdByProject,
    });

    onSave({
      crewId: crew.id,
      workDate,
      note: note.trim(),
      splits,
      previousAttendanceIds: batch.map((a) => a.id),
    });
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
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <ClipboardList size={14} className="text-accent" />
            Obecność — {crew.name}
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

        <div className="space-y-2.5">
          <Field label="Dzień">
            <IsoDateInput value={workDate} onChange={setWorkDate} />
          </Field>
          <Field label="Brygada">
            {options.length > 1 && !existing ? (
              <select
                value={crew.id}
                onChange={(e) => {
                  const next = options.find((c) => c.id === e.target.value);
                  setCrewId(e.target.value);
                  if (!existing && next) {
                    setWorkers(
                      resolveInitialWorkers({
                        existing: null,
                        crew: next,
                        crews,
                        attendance: attendanceHistory,
                        workDate,
                      }),
                    );
                  }
                }}
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              >
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.company ? ` · ${c.company}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised/60 px-3 py-2 text-sm text-ink">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: crew.color }}
                  aria-hidden
                />
                {crew.name}
                {crew.company ? (
                  <span className="truncate text-ink-faint">
                    · {crew.company}
                  </span>
                ) : null}
              </div>
            )}
          </Field>
          <Field label="Budowa (domyślna)">
            {projectOptions.length === 0 ? (
              <p className="text-sm text-ink-faint">Brak widocznych budów.</p>
            ) : (
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              >
                {projectOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {projectLabel(p)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <p className="-mt-1 text-[11px] text-ink-faint">
            Osoby i sprzęt domyślnie na tej budowie. Awaryjnie możesz zmienić
            budowę przy konkretnej osobie lub pozycji sprzętu.
          </p>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                  Osoby na budowie
                </p>
                <p className="text-[11px] text-ink-faint">
                  {workers.length} os. · {formatRh(laborTotal)} RH
                </p>
              </div>
              <button
                type="button"
                onClick={addWorker}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
              >
                <Plus size={12} />
                Dodaj
              </button>
            </div>
            {workers.length === 0 ? (
              <p className="text-[12px] text-ink-faint">
                Brak osób — dodaj wiersz (+).
              </p>
            ) : (
              <ul className="divide-y divide-line/50 overflow-hidden rounded-lg border border-line/70">
                {workers.map((row, index) => {
                  const hrs = shiftHours(row.startTime, row.endTime);
                  const override =
                    row.projectId.trim() && row.projectId !== projectId;
                  return (
                    <li
                      key={row.id}
                      className="space-y-1 bg-surface-raised/30 px-2 py-1.5"
                    >
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-4 shrink-0 text-center text-[11px] font-semibold tabular-nums text-ink-faint"
                          title={`Osoba ${index + 1}`}
                        >
                          {index + 1}
                        </span>
                        <HalfHourControl
                          value={row.startTime}
                          kind="start"
                          onChange={(v) =>
                            updateWorkerTime(row.id, "startTime", v)
                          }
                          aria-label={`Start osoby ${index + 1}`}
                        />
                        <span
                          className="shrink-0 text-[11px] text-ink-faint"
                          aria-hidden
                        >
                          →
                        </span>
                        <HalfHourControl
                          value={row.endTime}
                          kind="end"
                          onChange={(v) =>
                            updateWorkerTime(row.id, "endTime", v)
                          }
                          aria-label={`Koniec osoby ${index + 1}`}
                        />
                        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-faint">
                          {formatRh(hrs)}h
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setWorkers((prev) =>
                              prev.filter((x) => x.id !== row.id),
                            )
                          }
                          className="rounded p-1 text-ink-faint hover:bg-red-950/30 hover:text-red-300"
                          aria-label={`Usuń osobę ${index + 1}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 pl-5">
                        <span className="shrink-0 text-[10px] text-ink-faint">
                          Budowa
                        </span>
                        <select
                          value={row.projectId}
                          onChange={(e) =>
                            setWorkers((prev) =>
                              prev.map((x) =>
                                x.id === row.id
                                  ? { ...x, projectId: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          className={`min-w-0 flex-1 rounded border px-1.5 py-1 text-[11px] ${
                            override
                              ? "border-accent/50 bg-accent/10 text-ink"
                              : "border-line/70 bg-surface-raised text-ink-light"
                          }`}
                          aria-label={`Budowa osoby ${index + 1}`}
                        >
                          <option value="">Jak wyżej (domyślna)</option>
                          {projectOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {projectLabel(p)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {timesMixed && syncSource ? (
              <button
                type="button"
                onClick={applyTimesToAll}
                className="w-full rounded-lg bg-accent px-3 py-2 text-center text-[12px] font-semibold text-white shadow-sm transition hover:brightness-110"
              >
                Zastosuj {syncSource.startTime}–{syncSource.endTime} wszystkim
                osobom
              </button>
            ) : null}
          </div>

          <div className="space-y-2 border-t border-line/60 pt-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                Sprzęt ciężki
              </p>
              <button
                type="button"
                onClick={addEquipment}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
              >
                <Plus size={12} />
                Dodaj
              </button>
            </div>
            {equipment.length === 0 ? (
              <p className="text-[12px] text-ink-faint">Brak pozycji sprzętu.</p>
            ) : (
              <ul className="space-y-2">
                {equipment.map((row) => (
                  <li
                    key={row.key}
                    className="rounded-lg border border-line/70 bg-surface-raised/40 p-2"
                  >
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <select
                        value={row.equipmentKey}
                        onChange={(e) => {
                          const equipmentKey = e.target
                            .value as EquipmentPresetKey;
                          setEquipment((prev) =>
                            prev.map((x) =>
                              x.key === row.key
                                ? {
                                    ...x,
                                    equipmentKey,
                                    equipmentLabel:
                                      equipmentKey === "other"
                                        ? x.equipmentLabel
                                        : "",
                                  }
                                : x,
                            ),
                          );
                        }}
                        className="min-w-0 flex-1 rounded border border-line bg-surface-raised px-2 py-1.5 text-[12px] text-ink"
                      >
                        {EQUIPMENT_PRESET_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {EQUIPMENT_PRESET_LABEL[k]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() =>
                          setEquipment((prev) =>
                            prev.filter((x) => x.key !== row.key),
                          )
                        }
                        className="rounded p-1 text-ink-faint hover:bg-red-950/30 hover:text-red-300"
                        aria-label="Usuń sprzęt"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {row.equipmentKey === "other" ? (
                      <input
                        value={row.equipmentLabel}
                        onChange={(e) =>
                          setEquipment((prev) =>
                            prev.map((x) =>
                              x.key === row.key
                                ? { ...x, equipmentLabel: e.target.value }
                                : x,
                            ),
                          )
                        }
                        className="mb-1.5 w-full rounded border border-line bg-surface-raised px-2 py-1.5 text-[12px] text-ink"
                        placeholder="Nazwa sprzętu"
                      />
                    ) : null}
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="block space-y-0.5">
                        <span className="text-[10px] text-ink-faint">Ilość</span>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={row.quantity}
                          onChange={(e) =>
                            setEquipment((prev) =>
                              prev.map((x) =>
                                x.key === row.key
                                  ? { ...x, quantity: e.target.value }
                                  : x,
                              ),
                            )
                          }
                          className="w-full rounded border border-line bg-surface-raised px-2 py-1.5 text-[12px] text-ink"
                          placeholder="1"
                          aria-label="Ilość"
                        />
                      </label>
                      <label className="block space-y-0.5">
                        <span className="text-[10px] text-ink-faint">
                          Godziny pracy
                        </span>
                        <div className="relative">
                          <input
                            type="number"
                            min={0}
                            step="0.5"
                            inputMode="decimal"
                            value={row.hours}
                            onChange={(e) =>
                              setEquipment((prev) =>
                                prev.map((x) =>
                                  x.key === row.key
                                    ? { ...x, hours: e.target.value }
                                    : x,
                                ),
                              )
                            }
                            className="w-full rounded border border-line bg-surface-raised px-2 py-1.5 pr-7 text-[12px] text-ink"
                            placeholder="8"
                            aria-label="Godziny pracy"
                          />
                          <span
                            className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-ink-faint"
                            aria-hidden
                          >
                            h
                          </span>
                        </div>
                      </label>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="shrink-0 text-[10px] text-ink-faint">
                        Budowa
                      </span>
                      <select
                        value={row.projectId}
                        onChange={(e) =>
                          setEquipment((prev) =>
                            prev.map((x) =>
                              x.key === row.key
                                ? { ...x, projectId: e.target.value }
                                : x,
                            ),
                          )
                        }
                        className={`min-w-0 flex-1 rounded border px-1.5 py-1 text-[11px] ${
                          row.projectId.trim() && row.projectId !== projectId
                            ? "border-accent/50 bg-accent/10 text-ink"
                            : "border-line/70 bg-surface-raised text-ink-light"
                        }`}
                        aria-label="Budowa sprzętu"
                      >
                        <option value="">Jak wyżej (domyślna)</option>
                        {projectOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {projectLabel(p)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Field label="Notatka">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              placeholder="Opcjonalnie…"
            />
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap justify-between gap-2">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg px-3 py-1.5 text-sm text-red-400 hover:bg-red-950/30"
            >
              Usuń
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-ink-light"
            >
              Anuluj
            </button>
            <button
              type="button"
              onClick={submit}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white"
            >
              Zapisz
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Click time → vertical 30‑min list, scrolled around 07:00 (start) or 15:00 (end). */
function HalfHourControl({
  value,
  kind,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: string;
  kind: "start" | "end";
  onChange: (value: string) => void;
  "aria-label"?: string;
}) {
  const anchor = kind === "start" ? DEFAULT_WORK_START : DEFAULT_WORK_END;
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const placeMenu = () => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = 112;
    const height = 240;
    const left = Math.min(
      Math.max(8, r.left + r.width / 2 - width / 2),
      window.innerWidth - width - 8,
    );
    const below = r.bottom + 6;
    const top =
      below + height > window.innerHeight
        ? Math.max(8, r.top - height - 6)
        : below;
    setMenuPos({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    placeMenu();
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if ((t as Element).closest?.(`[data-half-hour-menu="${listId}"]`)) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => placeMenu();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, listId]);

  useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    // Open around typical shift times: 07:00 start / 15:00 end (scroll up & down from there).
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-time="${anchor}"]`,
    );
    if (!el) return;
    const list = listRef.current;
    const top = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2;
    list.scrollTop = Math.max(0, top);
  }, [open, anchor]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => {
            const next = !v;
            if (next) queueMicrotask(placeMenu);
            return next;
          });
        }}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={`inline-flex h-8 min-w-[3.4rem] items-center justify-center rounded-md border px-2 text-[13px] font-semibold tabular-nums transition ${
          open
            ? "border-accent bg-accent/10 text-accent"
            : "border-line bg-surface-raised text-ink hover:border-line-strong hover:text-accent"
        }`}
      >
        {value}
      </button>
      {open && menuPos
        ? createPortal(
            <div
              id={listId}
              ref={listRef}
              data-half-hour-menu={listId}
              role="listbox"
              aria-label={ariaLabel}
              style={{ top: menuPos.top, left: menuPos.left }}
              className="fixed z-[9300] max-h-60 w-[7rem] overflow-y-auto thin-scrollbar rounded-lg border border-line bg-surface-overlay py-1 shadow-pop"
            >
              {HALF_HOUR_TIMES.map((t) => {
                const selected = t === value;
                const isAnchor = t === anchor;
                return (
                  <button
                    key={t}
                    type="button"
                    role="option"
                    data-time={t}
                    aria-selected={selected}
                    onClick={() => {
                      onChange(t);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-center px-2 py-1.5 text-[13px] tabular-nums transition ${
                      selected
                        ? "bg-accent font-semibold text-white"
                        : isAnchor
                          ? "font-medium text-ink hover:bg-surface-raised"
                          : "text-ink-light hover:bg-surface-raised hover:text-ink"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
