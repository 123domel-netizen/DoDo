import { byCodeAsc, byPositionAsc } from "@/lib/boards/sections";
import type { BoardField, BoardTopic, GroupedTopics } from "@/lib/boards/types";

/** Filtr: fieldId → wybrane optionId (OR w polu). Puste / brak klucza = bez filtra. */
export type TopicFieldFilters = Record<string, string[]>;

export type TopicViewSort =
  | { mode: "manual" }
  | { mode: "code" }
  | { mode: "field"; fieldId: string };

export interface BoardTopicViewPrefs {
  /**
   * Kolumny na liście tematów.
   * `null` = wszystkie widoczne pola (domyślne — bez klikania w Widok).
   * `[]` = żadna kolumna; `[...]` = wybrany podzbiór.
   */
  columnIds: string[] | null;
  filters: TopicFieldFilters;
  sort: TopicViewSort;
}

export const EMPTY_VIEW_PREFS: BoardTopicViewPrefs = {
  columnIds: null,
  filters: {},
  sort: { mode: "manual" },
};

/**
 * Pola do wyświetlenia jako kolumny.
 * `null` / `[]` = wszystkie (domyślne + migracja starych prefs bez kolumn).
 */
export function resolveColumnFields(
  prefs: BoardTopicViewPrefs,
  fields: BoardField[],
): BoardField[] {
  if (prefs.columnIds == null || prefs.columnIds.length === 0) return fields;
  const byId = new Map(fields.map((f) => [f.id, f]));
  return prefs.columnIds.map((id) => byId.get(id)).filter((f): f is BoardField => Boolean(f));
}

export function viewStorageKey(boardId: string): string {
  return `dodo.boards.view.${boardId}`;
}

export function readViewPrefs(boardId: string): BoardTopicViewPrefs {
  try {
    const raw = localStorage.getItem(viewStorageKey(boardId));
    if (!raw) {
      // Migracja ze starego globalnego sortu Kod/Ręczne
      const legacy = localStorage.getItem("dodo.boards.topicListSort");
      if (legacy === "code") return { ...EMPTY_VIEW_PREFS, sort: { mode: "code" } };
      return { ...EMPTY_VIEW_PREFS };
    }
    const parsed = JSON.parse(raw) as Partial<BoardTopicViewPrefs>;
    const sort = parseSort(parsed.sort);
    return {
      columnIds: parseColumnIds(parsed.columnIds),
      filters: normalizeFilters(parsed.filters),
      sort,
    };
  } catch {
    return { ...EMPTY_VIEW_PREFS };
  }
}

export function writeViewPrefs(boardId: string, prefs: BoardTopicViewPrefs) {
  try {
    localStorage.setItem(viewStorageKey(boardId), JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

function parseSort(raw: unknown): TopicViewSort {
  if (!raw || typeof raw !== "object") return { mode: "manual" };
  const s = raw as { mode?: string; fieldId?: string };
  if (s.mode === "code") return { mode: "code" };
  if (s.mode === "field" && typeof s.fieldId === "string" && s.fieldId) {
    return { mode: "field", fieldId: s.fieldId };
  }
  return { mode: "manual" };
}

/** Brak / null → wszystkie kolumny; tablica → jawny wybór (może być pusta). */
function parseColumnIds(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  return raw.filter((id): id is string => typeof id === "string");
}

function normalizeFilters(raw: unknown): TopicFieldFilters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: TopicFieldFilters = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    const ids = v.filter((x): x is string => typeof x === "string");
    if (ids.length > 0) out[k] = ids;
  }
  return out;
}

/** Skrót wartości pola do komórki / chipa. */
export function formatFieldCell(topic: BoardTopic, field: BoardField): string {
  const value = topic.fieldValues[field.id];
  if (field.kind === "text") {
    const t = value?.text?.trim();
    return t || "—";
  }
  const ids = value?.optionIds ?? [];
  if (ids.length === 0) return "—";
  const labels = ids
    .map((id) => field.options.find((o) => o.id === id)?.label)
    .filter((x): x is string => Boolean(x));
  return labels.length > 0 ? labels.join(", ") : "—";
}

function sortKeyForField(topic: BoardTopic, field: BoardField): string {
  const cell = formatFieldCell(topic, field);
  return cell === "—" ? "" : cell;
}

export function compareByField(a: BoardTopic, b: BoardTopic, field: BoardField): number {
  const ka = sortKeyForField(a, field);
  const kb = sortKeyForField(b, field);
  if (!ka && !kb) return byPositionAsc(a, b);
  if (!ka) return 1;
  if (!kb) return -1;
  const cmp = ka.localeCompare(kb, "pl", { numeric: true, sensitivity: "base" });
  if (cmp !== 0) return cmp;
  return byPositionAsc(a, b);
}

/**
 * Filtr AND między polami; w polu OR opcji.
 * Ignoruje fieldId spoza `fields` (np. ukryte / usunięte).
 */
export function filterTopicsByFields(
  topics: BoardTopic[],
  fields: BoardField[],
  filters: TopicFieldFilters,
): BoardTopic[] {
  const choice = new Map(
    fields.filter((f) => f.kind === "single" || f.kind === "multi").map((f) => [f.id, f]),
  );
  const active = Object.entries(filters).filter(
    ([fieldId, optionIds]) => choice.has(fieldId) && optionIds.length > 0,
  );
  if (active.length === 0) return topics;

  return topics.filter((t) =>
    active.every(([fieldId, optionIds]) => {
      const have = new Set(t.fieldValues[fieldId]?.optionIds ?? []);
      return optionIds.some((id) => have.has(id));
    }),
  );
}

/** Oczyszcza prefs względem aktualnej listy pól (ACL / usunięte). */
export function sanitizeViewPrefs(
  prefs: BoardTopicViewPrefs,
  fields: BoardField[],
): BoardTopicViewPrefs {
  const ids = new Set(fields.map((f) => f.id));
  const columnIds =
    prefs.columnIds == null ? null : prefs.columnIds.filter((id) => ids.has(id));
  const filters: TopicFieldFilters = {};
  for (const [fieldId, optionIds] of Object.entries(prefs.filters)) {
    const field = fields.find((f) => f.id === fieldId);
    if (!field || (field.kind !== "single" && field.kind !== "multi")) continue;
    const optIds = new Set(field.options.map((o) => o.id));
    const kept = optionIds.filter((id) => optIds.has(id));
    if (kept.length > 0) filters[fieldId] = kept;
  }
  let sort = prefs.sort;
  if (sort.mode === "field" && !ids.has(sort.fieldId)) sort = { mode: "manual" };
  return { columnIds, filters, sort };
}

export function applyViewSort(grouped: GroupedTopics, sort: TopicViewSort, fields: BoardField[]): GroupedTopics {
  if (sort.mode === "manual") return grouped;
  if (sort.mode === "code") {
    return {
      ...grouped,
      pinned: [...grouped.pinned].sort(byCodeAsc),
      active: [...grouped.active].sort(byCodeAsc),
    };
  }
  const field = fields.find((f) => f.id === sort.fieldId);
  if (!field) return grouped;
  const cmp = (a: BoardTopic, b: BoardTopic) => compareByField(a, b, field);
  return {
    ...grouped,
    pinned: [...grouped.pinned].sort(cmp),
    active: [...grouped.active].sort(cmp),
  };
}

export function activeFilterChips(
  filters: TopicFieldFilters,
  fields: BoardField[],
): { fieldId: string; fieldName: string; optionId: string; label: string }[] {
  const out: { fieldId: string; fieldName: string; optionId: string; label: string }[] = [];
  for (const field of fields) {
    const ids = filters[field.id];
    if (!ids?.length) continue;
    for (const optionId of ids) {
      const opt = field.options.find((o) => o.id === optionId);
      if (!opt) continue;
      out.push({ fieldId: field.id, fieldName: field.name, optionId, label: opt.label });
    }
  }
  return out;
}
