import { byCodeAsc, byPositionAsc } from "@/lib/boards/sections";
import type {
  BoardDefaultTopicView,
  BoardField,
  BoardTopic,
  GroupedTopics,
} from "@/lib/boards/types";

/** Filtr: fieldId → wybrane optionId (OR w polu). Puste / brak klucza = bez filtra. */
export type TopicFieldFilters = Record<string, string[]>;

export type TopicViewSort =
  | { mode: "manual" }
  | { mode: "code" }
  /** Priorytet (kolejność opcji) → ostatnia aktywność → kod / data utworzenia. */
  | { mode: "smart" }
  | { mode: "field"; fieldId: string };

export interface BoardTopicViewPrefs {
  /**
   * Kolumny na liście tematów.
   * `null` = wszystkie widoczne pola (domyślne — bez klikania w Widok).
   * `[]` = żadna kolumna; `[...]` = wybrany podzbiór.
   */
  columnIds: string[] | null;
  filters: TopicFieldFilters;
  /** Wybrane miejscowości (OR). Puste = bez filtra. */
  localities: string[];
  sort: TopicViewSort;
}

type StoredViewPrefs = BoardTopicViewPrefs & { syncedDefaultRev?: number };

export const EMPTY_VIEW_PREFS: BoardTopicViewPrefs = {
  columnIds: null,
  filters: {},
  localities: [],
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

function parsePrefsObject(raw: unknown): BoardTopicViewPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_VIEW_PREFS };
  const parsed = raw as Partial<BoardTopicViewPrefs>;
  return {
    columnIds: parseColumnIds(parsed.columnIds),
    filters: normalizeFilters(parsed.filters),
    localities: normalizeLocalities(parsed.localities),
    sort: parseSort(parsed.sort),
  };
}

function readStoredViewPrefs(boardId: string): StoredViewPrefs | null {
  try {
    const raw = localStorage.getItem(viewStorageKey(boardId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredViewPrefs;
    const prefs = parsePrefsObject(parsed);
    const syncedDefaultRev =
      typeof parsed.syncedDefaultRev === "number" && Number.isFinite(parsed.syncedDefaultRev)
        ? Math.max(0, Math.floor(parsed.syncedDefaultRev))
        : 0;
    return { ...prefs, syncedDefaultRev };
  } catch {
    return null;
  }
}

/** Lokalne prefs bez uwzględnienia domyślnego widoku tablicy (legacy). */
export function readViewPrefs(boardId: string): BoardTopicViewPrefs {
  const stored = readStoredViewPrefs(boardId);
  if (stored) {
    const { syncedDefaultRev: _, ...prefs } = stored;
    return prefs;
  }
  const legacy = localStorage.getItem("dodo.boards.topicListSort");
  if (legacy === "code") return { ...EMPTY_VIEW_PREFS, sort: { mode: "code" } };
  return { ...EMPTY_VIEW_PREFS };
}

/**
 * Preferencje do UI: lokalne, o ile nie ma nowszego domyślnego widoku tablicy.
 * Po bumpie `defaultTopicViewRev` wszyscy dostają nowy default przy następnym wejściu.
 */
export function resolveViewPrefs(
  boardId: string,
  boardDefault: BoardDefaultTopicView | null | undefined,
  boardDefaultRev: number,
  fields: BoardField[],
): BoardTopicViewPrefs {
  const rev = Math.max(0, Math.floor(boardDefaultRev || 0));
  const stored = readStoredViewPrefs(boardId);
  const boardPrefs = sanitizeViewPrefs(
    parsePrefsObject(boardDefault ?? EMPTY_VIEW_PREFS),
    fields,
  );

  if (!stored) {
    const legacy = localStorage.getItem("dodo.boards.topicListSort");
    if (legacy === "code" && rev === 0 && !boardDefault) {
      return { ...EMPTY_VIEW_PREFS, sort: { mode: "code" } };
    }
    const next = rev > 0 || boardDefault ? boardPrefs : { ...EMPTY_VIEW_PREFS };
    writeViewPrefs(boardId, next, rev);
    return next;
  }

  const { syncedDefaultRev = 0, ...personal } = stored;
  if (rev > syncedDefaultRev) {
    writeViewPrefs(boardId, boardPrefs, rev);
    return boardPrefs;
  }
  return personal;
}

export function writeViewPrefs(
  boardId: string,
  prefs: BoardTopicViewPrefs,
  syncedDefaultRev = 0,
) {
  try {
    const payload: StoredViewPrefs = {
      ...prefs,
      syncedDefaultRev: Math.max(0, Math.floor(syncedDefaultRev)),
    };
    localStorage.setItem(viewStorageKey(boardId), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

/** Widok do zapisu jako default tablicy — tylko pola widoczne dla wszystkich. */
export function prefsForBoardDefault(
  prefs: BoardTopicViewPrefs,
  fields: BoardField[],
): BoardDefaultTopicView {
  const publicFields = fields.filter((f) => f.visibility === "all");
  const clean = sanitizeViewPrefs(prefs, publicFields);
  return {
    columnIds: clean.columnIds,
    filters: clean.filters,
    localities: clean.localities,
    sort: clean.sort,
  };
}

export function parseBoardDefaultView(raw: unknown): BoardDefaultTopicView | null {
  if (raw == null) return null;
  const prefs = parsePrefsObject(raw);
  return {
    columnIds: prefs.columnIds,
    filters: prefs.filters,
    localities: prefs.localities,
    sort: prefs.sort,
  };
}

function parseSort(raw: unknown): TopicViewSort {
  if (!raw || typeof raw !== "object") return { mode: "manual" };
  const s = raw as { mode?: string; fieldId?: string };
  if (s.mode === "code") return { mode: "code" };
  if (s.mode === "smart") return { mode: "smart" };
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

function normalizeLocalities(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== "string") continue;
    const t = x.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Unikalne miejscowości z tematów (do checkboxów filtra). */
export function collectTopicLocalities(topics: BoardTopic[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of topics) {
    const loc = t.locality?.trim();
    if (!loc || seen.has(loc)) continue;
    seen.add(loc);
    out.push(loc);
  }
  return out.sort((a, b) => a.localeCompare(b, "pl", { sensitivity: "base" }));
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

/** Rank opcji (min. position wybranych); puste = Infinity (na końcu). */
export function optionSortRank(topic: BoardTopic, field: BoardField): number {
  if (field.kind === "text") return Number.POSITIVE_INFINITY;
  const ids = topic.fieldValues[field.id]?.optionIds ?? [];
  if (ids.length === 0) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (const id of ids) {
    const opt = field.options.find((o) => o.id === id);
    if (!opt) continue;
    if (opt.position < best) best = opt.position;
  }
  return best;
}

/**
 * Pole priorytetu: najpierw nazwa Priorytet/Priority (single),
 * inaczej pierwsze single wg position na tablicy.
 */
export function resolvePriorityField(fields: BoardField[]): BoardField | null {
  const singles = fields.filter((f) => f.kind === "single");
  if (singles.length === 0) return null;
  const named = singles.find((f) => /^(priorytet|priority)$/i.test(f.name.trim()));
  if (named) return named;
  return [...singles].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))[0] ?? null;
}

export function compareByField(a: BoardTopic, b: BoardTopic, field: BoardField): number {
  if (field.kind === "single" || field.kind === "multi") {
    const ra = optionSortRank(a, field);
    const rb = optionSortRank(b, field);
    if (ra !== rb) {
      if (!Number.isFinite(ra) && !Number.isFinite(rb)) return byPositionAsc(a, b);
      if (!Number.isFinite(ra)) return 1;
      if (!Number.isFinite(rb)) return -1;
      return ra - rb;
    }
    return byPositionAsc(a, b);
  }
  const ka = sortKeyForField(a, field);
  const kb = sortKeyForField(b, field);
  if (!ka && !kb) return byPositionAsc(a, b);
  if (!ka) return 1;
  if (!kb) return -1;
  const cmp = ka.localeCompare(kb, "pl", { numeric: true, sensitivity: "base" });
  if (cmp !== 0) return cmp;
  return byPositionAsc(a, b);
}

/** Priorytet (kolejność opcji) → lastActivityAt → kod / createdAt. */
export function compareSmart(a: BoardTopic, b: BoardTopic, fields: BoardField[]): number {
  const priority = resolvePriorityField(fields);
  if (priority) {
    const ra = optionSortRank(a, priority);
    const rb = optionSortRank(b, priority);
    if (ra !== rb) {
      if (!Number.isFinite(ra)) return 1;
      if (!Number.isFinite(rb)) return -1;
      return ra - rb;
    }
  }
  const act = Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
  if (Number.isFinite(act) && act !== 0) return act;
  return byCodeAsc(a, b);
}

export function compareViewTopics(
  a: BoardTopic,
  b: BoardTopic,
  sort: TopicViewSort,
  fields: BoardField[],
): number {
  if (sort.mode === "smart") return compareSmart(a, b, fields);
  if (sort.mode === "field") {
    const field = fields.find((f) => f.id === sort.fieldId);
    if (!field) return byPositionAsc(a, b);
    return compareByField(a, b, field);
  }
  if (sort.mode === "code") return byCodeAsc(a, b);
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

/** OR wybranych miejscowości; puste = bez filtra. */
export function filterTopicsByLocality(
  topics: BoardTopic[],
  localities: string[],
): BoardTopic[] {
  if (localities.length === 0) return topics;
  const want = new Set(localities);
  return topics.filter((t) => t.locality != null && want.has(t.locality));
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
  const localities = normalizeLocalities(prefs.localities);
  let sort = prefs.sort;
  if (sort.mode === "field" && !ids.has(sort.fieldId)) sort = { mode: "manual" };
  return { columnIds, filters, localities, sort };
}

export function applyViewSort(grouped: GroupedTopics, sort: TopicViewSort, fields: BoardField[]): GroupedTopics {
  if (sort.mode === "manual") return grouped;
  const cmp = (a: BoardTopic, b: BoardTopic) => compareViewTopics(a, b, sort, fields);
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
