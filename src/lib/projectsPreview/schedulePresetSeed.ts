import type { ScheduleCatalogPreset } from "./scheduleCatalog";
import type { ScheduleBlock, ScheduleCategoryMeta } from "./types";

/** Etapy reaktywne / nieplanowane — pomijane w presecie startowym. */
export const PRESET_SKIP_CATEGORY_IDS = new Set(["reklamacja"]);

/** Względne wagi etapów na typową budowę (~12 mies.). */
const CATEGORY_WEIGHTS: Record<string, number> = {
  "stan-0": 16,
  "stan-surowy-otwarty": 20,
  "stan-surowy-zamkniety": 14,
  instalacje: 16,
  "deweloperski-wew": 16,
  "deweloperski-zew": 12,
  "stan-pod-klucz": 6,
};

const PRESET_COLORS = [
  "#6b8ab8",
  "#c4a35a",
  "#5a9e84",
  "#c47a7a",
  "#8f7eb8",
  "#5a9eab",
  "#c48a5c",
  "#7a8494",
];

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

/** Domyślny koniec: ~12 miesięcy od startu (ostatni dzień okna). */
export function defaultPlannedEndDate(startDate: string): string {
  return addDaysIso(addMonthsIso(startDate, 12), -1);
}

/** Liczba dni włącznie między dwoma datami ISO. */
export function inclusiveDayCount(start: string, end: string): number {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const a = Date.UTC(ys!, ms! - 1, ds!);
  const b = Date.UTC(ye!, me! - 1, de!);
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function weightFor(categoryId: string): number {
  return CATEGORY_WEIGHTS[categoryId] ?? 10;
}

function scopesForPreset(scopes: string[]): string[] {
  return scopes.filter((s) => s.trim() && s !== "Inny");
}

/** Podział [start,end] na N kolejnych okien wg wag (ostatnie dostaje resztę). */
export function allocateWindows(
  start: string,
  end: string,
  weights: number[],
): { start: string; end: string }[] {
  if (weights.length === 0) return [];
  const totalDays = inclusiveDayCount(start, end);
  const sumW = weights.reduce((a, b) => a + b, 0) || weights.length;
  const out: { start: string; end: string }[] = [];
  let cursor = 0;
  for (let i = 0; i < weights.length; i++) {
    const isLast = i === weights.length - 1;
    const slice = isLast
      ? totalDays - cursor
      : Math.max(1, Math.round((weights[i]! / sumW) * totalDays));
    const winStart = addDaysIso(start, cursor);
    const winEnd = addDaysIso(start, cursor + slice - 1);
    out.push({
      start: winStart,
      end: winEnd < winStart ? winStart : winEnd,
    });
    cursor += slice;
  }
  // Clamp last end to requested end (rounding may overshoot earlier slices).
  const last = out[out.length - 1]!;
  if (last.end > end) last.end = end;
  if (last.end < last.start) last.end = last.start;
  return out;
}

export function countPresetItems(catalog: ScheduleCatalogPreset): {
  categories: number;
  subcategories: number;
} {
  const cats = catalog.categories.filter(
    (c) => !PRESET_SKIP_CATEGORY_IDS.has(c.id),
  );
  let subcategories = 0;
  for (const c of cats) subcategories += scopesForPreset(c.scopes).length;
  return { categories: cats.length, subcategories };
}

/**
 * Szkielet harmonogramu: kategorie (meta + okna) + podkategorie z katalogu.
 * Bez zakresów (role: work).
 */
export function buildProjectSchedulePreset(opts: {
  projectId: string;
  startDate: string;
  endDate: string;
  catalog: ScheduleCatalogPreset;
  uid: () => string;
}): { blocks: ScheduleBlock[]; categoryMeta: ScheduleCategoryMeta[] } {
  const startDate = opts.startDate.trim();
  let endDate = opts.endDate.trim();
  if (!startDate || !endDate) {
    return { blocks: [], categoryMeta: [] };
  }
  if (endDate < startDate) endDate = startDate;

  const categories = opts.catalog.categories
    .filter((c) => !PRESET_SKIP_CATEGORY_IDS.has(c.id))
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (categories.length === 0) return { blocks: [], categoryMeta: [] };

  const catWindows = allocateWindows(
    startDate,
    endDate,
    categories.map((c) => weightFor(c.id)),
  );

  const categoryMeta: ScheduleCategoryMeta[] = [];
  const blocks: ScheduleBlock[] = [];
  let colorIdx = 0;

  categories.forEach((cat, i) => {
    const win = catWindows[i]!;
    categoryMeta.push({
      projectId: opts.projectId,
      categoryId: cat.id,
      title: "",
      note: "",
      startDate: win.start,
      endDate: win.end,
    });

    const scopes = scopesForPreset(cat.scopes);
    if (scopes.length === 0) return;

    const subWindows = allocateWindows(
      win.start,
      win.end,
      scopes.map(() => 1),
    );

    scopes.forEach((scope, j) => {
      const sw = subWindows[j]!;
      blocks.push({
        id: opts.uid(),
        projectId: opts.projectId,
        title: scope,
        categoryId: cat.id,
        scope,
        role: "subcategory",
        parentId: null,
        crewId: "",
        startDate: sw.start,
        endDate: sw.end,
        status: "planowane",
        color: PRESET_COLORS[colorIdx++ % PRESET_COLORS.length]!,
        note: "",
      });
    });
  });

  return { blocks, categoryMeta };
}
