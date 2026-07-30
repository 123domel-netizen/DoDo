import { useState, type ReactNode } from "react";
import { ClipboardList, X, Zap } from "lucide-react";
import { createPortal } from "react-dom";
import { todayIso } from "@/lib/projectsPreview/projectMetrics";
import type { ScheduleCatalogPreset } from "@/lib/projectsPreview/scheduleCatalog";
import {
  DOC_EVENT_STATUS_LABEL,
  DOC_EVENT_STATUSES,
  PROJECT_LEVEL_EVENT_CATEGORY,
  SCHEDULE_EVENT_KIND_LABEL,
  isProjectLevelEventCategory,
  projectLabel,
  type DocEventStatus,
  type PreviewProject,
  type ScheduleBlock,
  type ScheduleCategoryMeta,
  type ScheduleEvent,
  type ScheduleEventKind,
  type SupervisionCatalogPreset,
} from "@/lib/projectsPreview/types";
import { IsoDateInput } from "./IsoDateInput";

export type ScheduleEventDraft = Omit<ScheduleEvent, "id"> & { id?: string };

interface ScheduleEventSheetProps {
  projectId: string;
  /** Display name of the investment (project-level placement option). */
  project?: Pick<PreviewProject, "number" | "name"> | null;
  /** Blocks the event can hang off — works and subcategories of this budowa. */
  blocks: ScheduleBlock[];
  /** Category meta for this budowa (custom titles / planned windows). */
  categoryMeta?: ScheduleCategoryMeta[];
  /** Preselected block, e.g. the row the ⚡ was clicked on. */
  blockId: string | null;
  /** Prefill category when opening from a category lane. */
  defaultCategoryId?: string;
  /** null = create a new event. */
  event: ScheduleEvent | null;
  /** Which kind the creation flow starts on. */
  defaultKind?: ScheduleEventKind;
  /**
   * When set, kind cannot be switched. Prefer locking only while editing an
   * existing event (create flows keep the Budowlane / Dokumentacyjne toggle).
   */
  lockKind?: boolean;
  defaultDate?: string;
  /** Katalog czynności dokumentacyjnych. */
  catalog: SupervisionCatalogPreset;
  /** Katalog kategorii / zakresów harmonogramu — tytuły kategorii na osi. */
  scheduleCatalog: ScheduleCatalogPreset;
  onClose: () => void;
  onSave: (data: ScheduleEventDraft) => void;
  onDelete?: () => void;
}

const KINDS: ScheduleEventKind[] = ["budowlane", "dokumentacyjne"];

/**
 * Single add/edit sheet for both kinds of zdarzenie.
 * Budowlane: categories present on this budowa's schedule (+ investment row).
 * Dokumentacyjne: supervision catalog stages + activities.
 */
export function ScheduleEventSheet({
  projectId,
  project,
  blocks,
  categoryMeta = [],
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
  const investmentLabel = project
    ? projectLabel(project)
    : "Inwestycja";
  const scheduleCats = (() => {
    const base = scheduleCategoriesOnProject(
      blocks,
      categoryMeta,
      scheduleCatalog,
      projectId,
    );
    // Keep a legacy / removed category selectable while editing.
    const current =
      event?.kind === "budowlane" &&
      event.categoryId &&
      !isProjectLevelEventCategory(event.categoryId) &&
      !base.some((c) => c.id === event.categoryId)
        ? [
            {
              id: event.categoryId,
              title:
                scheduleCatalog.categories.find((c) => c.id === event.categoryId)
                  ?.title ?? event.categoryId,
              sortOrder: 998,
            },
          ]
        : [];
    return [...base, ...current];
  })();
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

  const initialKind = event?.kind ?? defaultKind;
  const inferredCategory =
    event?.categoryId ||
    defaultCategoryId ||
    (initialKind === "dokumentacyjne"
      ? docCategories[0]?.id
      : blockCategory(blocks, initialBlockId) ||
        PROJECT_LEVEL_EVENT_CATEGORY) ||
    "";
  const [categoryId, setCategoryId] = useState(inferredCategory);
  const [categoryTouched, setCategoryTouched] = useState(
    Boolean(event?.categoryId),
  );

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
  const atProjectLevel = !isDoc && isProjectLevelEventCategory(categoryId);

  const blocksForCategory = blocks
    .filter((b) => !atProjectLevel && (!categoryId || b.categoryId === categoryId))
    .slice()
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === "subcategory" ? -1 : 1;
      return (a.title || a.scope).localeCompare(b.title || b.scope);
    });

  const switchKind = (next: ScheduleEventKind) => {
    setKind(next);
    setCategoryTouched(false);
    setSelectedBlockId("");
    if (next === "dokumentacyjne") {
      const first = docCategories[0]?.id ?? "";
      setCategoryId(first);
      const acts =
        docCategories.find((c) => c.id === first)?.activities ?? ["Inny"];
      setActivity(acts[0] ?? "");
      setCustomLabel("");
      return;
    }
    const first =
      blockCategory(blocks, blockId ?? "") || PROJECT_LEVEL_EVENT_CATEGORY;
    setCategoryId(first);
  };

  const onBlockChange = (id: string) => {
    setSelectedBlockId(id);
    const block = blocks.find((b) => b.id === id);
    if (block && !categoryTouched) {
      setCategoryId(block.categoryId);
    }
    if (dateTouched) return;
    if (block?.startDate) setDate(block.startDate);
  };

  const onCategoryChange = (id: string) => {
    setCategoryTouched(true);
    setCategoryId(id);
    if (kind === "dokumentacyjne") {
      const acts =
        docCategories.find((c) => c.id === id)?.activities ?? ["Inny"];
      setActivity(acts[0] ?? "");
      setCustomLabel("");
      return;
    }
    if (
      isProjectLevelEventCategory(id) ||
      (selectedBlockId &&
        blocks.find((b) => b.id === selectedBlockId)?.categoryId !== id)
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
    const projectLevel = isProjectLevelEventCategory(categoryId);
    onSave({
      id: event?.id,
      projectId: selectedBlock?.projectId ?? projectId,
      blockId: projectLevel ? null : selectedBlockId || null,
      kind: "budowlane",
      title: title.trim(),
      date,
      note: note.trim(),
      categoryId: projectLevel ? PROJECT_LEVEL_EVENT_CATEGORY : categoryId,
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
              <Zap size={14} className="shrink-0 text-amber-300" />
            )}
            <span className="truncate">{heading}</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ink-faint hover:bg-surface-raised hover:text-ink"
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
                    onClick={() => switchKind(k)}
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
              : "Zdarzenie budowlane to punkt na osi: kategoria z harmonogramu tej budowy albo wiersz inwestycji."}
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
                  <option value={PROJECT_LEVEL_EVENT_CATEGORY}>
                    {investmentLabel}
                  </option>
                  {scheduleCats.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </Field>

              {atProjectLevel ? null : blockFixed && selectedBlock ? (
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
              className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-light hover:border-line-strong hover:text-ink"
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

/** Categories already present on this budowa's schedule (blocks / meta). */
function scheduleCategoriesOnProject(
  blocks: ScheduleBlock[],
  categoryMeta: ScheduleCategoryMeta[],
  scheduleCatalog: ScheduleCatalogPreset,
  projectId: string,
): Array<{ id: string; title: string; sortOrder: number }> {
  const ids = new Set<string>();
  for (const b of blocks) {
    if (b.projectId === projectId && b.categoryId) ids.add(b.categoryId);
  }
  for (const m of categoryMeta) {
    if (m.projectId === projectId && m.categoryId) ids.add(m.categoryId);
  }
  const out: Array<{ id: string; title: string; sortOrder: number }> = [];
  for (const id of ids) {
    if (isProjectLevelEventCategory(id)) continue;
    const meta = categoryMeta.find(
      (m) => m.projectId === projectId && m.categoryId === id,
    );
    const cat = scheduleCatalog.categories.find((c) => c.id === id);
    out.push({
      id,
      title: meta?.title?.trim() || cat?.title || id,
      sortOrder: cat?.sortOrder ?? 999,
    });
  }
  return out.sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
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
