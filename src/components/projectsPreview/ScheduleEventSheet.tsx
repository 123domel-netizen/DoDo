import { useState, type ReactNode } from "react";
import { ClipboardList, X, Zap } from "lucide-react";
import { createPortal } from "react-dom";
import { todayIso } from "@/lib/projectsPreview/projectMetrics";
import type { ScheduleCatalogPreset } from "@/lib/projectsPreview/scheduleCatalog";
import {
  DOC_EVENT_STATUS_LABEL,
  DOC_EVENT_STATUSES,
  SCHEDULE_EVENT_KIND_LABEL,
  type DocEventStatus,
  type ScheduleBlock,
  type ScheduleEvent,
  type ScheduleEventKind,
  type SupervisionCatalogPreset,
} from "@/lib/projectsPreview/types";
import { IsoDateInput } from "./IsoDateInput";

export type ScheduleEventDraft = Omit<ScheduleEvent, "id"> & { id?: string };

interface ScheduleEventSheetProps {
  projectId: string;
  /** Blocks the event can hang off — works and subcategories of this budowa. */
  blocks: ScheduleBlock[];
  /** Preselected block, e.g. the row the ⚡ was clicked on. */
  blockId: string | null;
  /** Prefill category when opening from a category lane. */
  defaultCategoryId?: string;
  /** null = create a new event. */
  event: ScheduleEvent | null;
  /** Which kind the creation flow starts on. */
  defaultKind?: ScheduleEventKind;
  /**
   * When set, kind cannot be switched (docs = investment only,
   * construction = category lanes).
   */
  lockKind?: boolean;
  defaultDate?: string;
  /** Katalog czynności dokumentacyjnych. */
  catalog: SupervisionCatalogPreset;
  /** Katalog kategorii / zakresów harmonogramu — główne miejsce na osi. */
  scheduleCatalog: ScheduleCatalogPreset;
  onClose: () => void;
  onSave: (data: ScheduleEventDraft) => void;
  onDelete?: () => void;
}

const KINDS: ScheduleEventKind[] = ["budowlane", "dokumentacyjne"];

/**
 * Single add/edit sheet for both kinds of zdarzenie.
 * Budowlane: category lane (+ optional block). Dokumentacyjne: investment only.
 */
export function ScheduleEventSheet({
  projectId,
  blocks,
  blockId,
  defaultCategoryId,
  event,
  defaultKind = "budowlane",
  lockKind = false,
  defaultDate,
  catalog,
  scheduleCatalog,
  onClose,
  onSave,
  onDelete,
}: ScheduleEventSheetProps) {
  const placementCats = mergePlacementCategories(scheduleCatalog, catalog);
  const docCategories = catalog.categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const [kind, setKind] = useState<ScheduleEventKind>(
    event?.kind ?? defaultKind,
  );
  const kindLocked = lockKind || Boolean(event);
  const initialBlockId =
    (event?.kind ?? defaultKind) === "dokumentacyjne"
      ? ""
      : (event?.blockId ?? blockId ?? "");
  const [selectedBlockId, setSelectedBlockId] = useState(initialBlockId);

  const inferredCategory =
    event?.categoryId ||
    defaultCategoryId ||
    (defaultKind === "dokumentacyjne" || event?.kind === "dokumentacyjne"
      ? docCategories[0]?.id
      : blockCategory(blocks, initialBlockId) || placementCats[0]?.id) ||
    "";
  const [categoryId, setCategoryId] = useState(inferredCategory);
  const [categoryTouched, setCategoryTouched] = useState(Boolean(event?.categoryId));

  const [title, setTitle] = useState(
    event?.kind === "budowlane" ? event.title : "",
  );
  const [date, setDate] = useState(
    event?.date ??
      defaultDate ??
      blocks.find((b) => b.id === initialBlockId)?.startDate ??
      todayIso(),
  );
  const [dateTouched, setDateTouched] = useState(false);
  const [note, setNote] = useState(event?.note ?? "");

  const docActivities =
    docCategories.find((c) => c.id === categoryId)?.activities ?? ["Inny"];
  const [activity, setActivity] = useState(
    event?.activity ?? docActivities[0] ?? "",
  );
  const [customLabel, setCustomLabel] = useState(event?.customLabel ?? "");
  const [status, setStatus] = useState<DocEventStatus>(
    event?.status ?? "do_wpisania",
  );

  const isDoc = kind === "dokumentacyjne";
  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null;
  /** A block handed in from the timeline stays fixed while creating. */
  const blockFixed = !event && blockId != null;

  const blocksForCategory = blocks
    .filter((b) => !categoryId || b.categoryId === categoryId)
    .slice()
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "subcategory" ? -1 : 1;
      return (a.title || a.scope).localeCompare(b.title || b.scope);
    });

  const onBlockChange = (id: string) => {
    setSelectedBlockId(id);
    const block = blocks.find((b) => b.id === id);
    if (block && !categoryTouched) {
      setCategoryId(block.categoryId);
      const acts =
        docCategories.find((c) => c.id === block.categoryId)?.activities ?? [
          "Inny",
        ];
      setActivity(acts[0] ?? "");
      setCustomLabel("");
    }
    if (dateTouched) return;
    if (block?.startDate) setDate(block.startDate);
  };

  const onCategoryChange = (id: string) => {
    setCategoryTouched(true);
    setCategoryId(id);
    const acts =
      docCategories.find((c) => c.id === id)?.activities ?? ["Inny"];
    setActivity(acts[0] ?? "");
    setCustomLabel("");
    if (
      selectedBlockId &&
      blocks.find((b) => b.id === selectedBlockId)?.categoryId !== id
    ) {
      setSelectedBlockId("");
    }
  };

  const submit = () => {
    if (!categoryId) {
      alert("Wybierz kategorię.");
      return;
    }
    if (isDoc) {
      if (!activity) {
        alert("Wybierz czynność z katalogu.");
        return;
      }
      if (activity === "Inny" && !customLabel.trim()) {
        alert("Podaj opis własnej czynności.");
        return;
      }
      onSave({
        id: event?.id,
        projectId,
        blockId: null,
        kind: "dokumentacyjne",
        title: activity === "Inny" ? customLabel.trim() : activity,
        date,
        note: note.trim(),
        status,
        categoryId,
        activity,
        customLabel: activity === "Inny" ? customLabel.trim() : undefined,
      });
      return;
    }
    if (!title.trim()) {
      alert("Podaj treść zdarzenia budowlanego.");
      return;
    }
    onSave({
      id: event?.id,
      projectId: selectedBlock?.projectId ?? projectId,
      blockId: selectedBlockId || null,
      kind: "budowlane",
      title: title.trim(),
      date,
      note: note.trim(),
      categoryId,
    });
  };

  const heading = event
    ? `Edycja zdarzenia — ${SCHEDULE_EVENT_KIND_LABEL[kind].toLowerCase()}`
    : "Nowe zdarzenie";

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
            {isDoc ? (
              <ClipboardList size={14} className="shrink-0 text-sky-300" />
            ) : (
              <Zap size={14} className="shrink-0 text-amber-400" />
            )}
            <span className="truncate">{heading}</span>
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
          {!kindLocked ? (
            <Field label="Rodzaj zdarzenia">
              <div className="flex gap-1 rounded-lg bg-surface-raised/60 p-0.5">
                {KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    aria-pressed={kind === k}
                    className={`flex-1 rounded-md px-2 py-1.5 text-[12px] font-medium transition ${
                      kind === k
                        ? "bg-accent/15 text-accent"
                        : "text-ink-faint hover:text-ink"
                    }`}
                  >
                    {SCHEDULE_EVENT_KIND_LABEL[k]}
                  </button>
                ))}
              </div>
            </Field>
          ) : null}

          <p className="text-[11px] leading-relaxed text-ink-faint">
            {isDoc
              ? "Zdarzenie dokumentacyjne należy do inwestycji — katalog czynności nadzoru, osobno od harmonogramu kategorii. Na osi widać je w wierszu inwestycji / Dokumentacja."
              : "Zdarzenie budowlane to punkt na osi w wierszu kategorii — nie robota i nie zadanie w kalendarzu."}
          </p>

          {isDoc ? (
            <Field label="Etap katalogu (czynności)">
              <select
                value={categoryId}
                onChange={(e) => onCategoryChange(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              >
                {docCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <>
              <Field label="Kategoria">
                <select
                  value={categoryId}
                  onChange={(e) => onCategoryChange(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                >
                  {placementCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </Field>

              {blockFixed && selectedBlock ? (
                <Field label="Podkategoria / robota">
                  <p className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink-light">
                    {blockOptionLabel(selectedBlock)}
                  </p>
                </Field>
              ) : (
                <Field label="Podkategoria / robota (opcjonalnie)">
                  <select
                    value={selectedBlockId}
                    onChange={(e) => onBlockChange(e.target.value)}
                    className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                  >
                    <option value="">Tylko kategoria</option>
                    {blocksForCategory.map((b) => (
                      <option key={b.id} value={b.id}>
                        {blockOptionLabel(b)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}

          {isDoc ? (
            <>
              <Field label="Czynność">
                <select
                  value={activity}
                  onChange={(e) => setActivity(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                >
                  {docActivities.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </Field>
              {activity === "Inny" ? (
                <Field label="Opis">
                  <input
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                    placeholder="Własna czynność…"
                  />
                </Field>
              ) : null}
              <Field label="Stan">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as DocEventStatus)}
                  className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                >
                  {DOC_EVENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {DOC_EVENT_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          ) : (
            <Field label="Co się wydarzy">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
                placeholder="np. Przyjedzie dźwig do układania stropu"
                autoFocus
              />
            </Field>
          )}

          <Field label="Data">
            <IsoDateInput
              value={date}
              onChange={(iso) => {
                setDateTouched(true);
                setDate(iso);
              }}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 pr-9 text-sm text-ink outline-none focus:border-line-strong"
            />
          </Field>
          <Field label="Notatka">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="w-full resize-none rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              placeholder="Krótki opis sytuacji…"
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

function mergePlacementCategories(
  schedule: ScheduleCatalogPreset,
  doc: SupervisionCatalogPreset,
): Array<{ id: string; title: string; sortOrder: number }> {
  const map = new Map<string, { id: string; title: string; sortOrder: number }>();
  for (const c of schedule.categories) {
    map.set(c.id, { id: c.id, title: c.title, sortOrder: c.sortOrder });
  }
  for (const c of doc.categories) {
    if (map.has(c.id)) continue;
    map.set(c.id, {
      id: c.id,
      title: c.title,
      sortOrder: 1000 + c.sortOrder,
    });
  }
  return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

function blockCategory(
  blocks: ScheduleBlock[],
  blockId: string,
): string | undefined {
  return blocks.find((b) => b.id === blockId)?.categoryId;
}

function blockOptionLabel(b: ScheduleBlock): string {
  const role = b.role === "subcategory" ? "Podkategoria" : "Robota";
  return `${role}: ${b.title || b.scope}`;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
