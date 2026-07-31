const STORAGE_KEY = "dodo-schedule-row-collapse-v1";

export function projectCollapseKey(projectId: string): string {
  return `proj:${projectId}`;
}

export function categoryCollapseKey(
  projectId: string,
  categoryId: string,
): string {
  return `cat:${projectId}::${categoryId}`;
}

export function subcategoryCollapseKey(subcategoryId: string): string {
  return `sub:${subcategoryId}`;
}

export type ScheduleCollapseInventory = {
  projectKeys: string[];
  categoryKeys: string[];
  subcategoryKeys: string[];
};

/**
 * 0 — tylko nagłówki kategorii
 * 1 — + podkategorie (bez zakresów)
 * 2 — + zakresy (pełne drzewo)
 *
 * Starsze zapisy miały 0–3; mapujemy przy odczycie.
 */
export type ScheduleRevealLevel = 0 | 1 | 2;

type StoredCollapse = {
  collapsed: string[];
  revealLevel: ScheduleRevealLevel | number;
};

function clampLevel(n: unknown): ScheduleRevealLevel {
  const v = Number(n);
  // Legacy 0|1|2|3 → new 0|1|2
  if (v >= 3) return 2;
  if (v === 2) return 1;
  if (v === 1) return 1;
  return 0;
}

export function loadScheduleCollapseState(): {
  collapsed: Set<string>;
  revealLevel: ScheduleRevealLevel;
} {
  if (typeof localStorage === "undefined") {
    return { collapsed: new Set(), revealLevel: 2 };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { collapsed: new Set(), revealLevel: 2 };
    const parsed = JSON.parse(raw) as StoredCollapse | string[];
    // Legacy: plain string[]
    if (Array.isArray(parsed)) {
      return {
        collapsed: new Set(
          parsed.filter((x): x is string => typeof x === "string"),
        ),
        revealLevel: 2,
      };
    }
    return {
      collapsed: new Set(
        (parsed.collapsed ?? []).filter(
          (x): x is string => typeof x === "string",
        ),
      ),
      revealLevel: clampLevel(parsed.revealLevel),
    };
  } catch {
    return { collapsed: new Set(), revealLevel: 2 };
  }
}

export function saveScheduleCollapseState(
  collapsed: Set<string>,
  revealLevel: ScheduleRevealLevel,
) {
  if (typeof localStorage === "undefined") return;
  try {
    const payload: StoredCollapse = {
      collapsed: [...collapsed],
      revealLevel,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

export function toggleCollapsedKey(
  prev: Set<string>,
  key: string,
  revealLevel: ScheduleRevealLevel,
): Set<string> {
  const next = new Set(prev);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  saveScheduleCollapseState(next, revealLevel);
  return next;
}

/** Zwiń wszystko do nagłówków inwestycji / kategorii. */
export function collapseAllScheduleRows(
  inventory: ScheduleCollapseInventory,
): { collapsed: Set<string>; revealLevel: ScheduleRevealLevel } {
  const collapsed = new Set<string>([
    ...inventory.projectKeys,
    ...inventory.categoryKeys,
    ...inventory.subcategoryKeys,
  ]);
  const revealLevel: ScheduleRevealLevel = 0;
  saveScheduleCollapseState(collapsed, revealLevel);
  return { collapsed, revealLevel };
}

/**
 * Kolejne kliknięcie rozwijania: 0→1 podkategorie, 1→2 zakresy.
 * Czyści też ręczne zwinięcia inwestycji (żeby rozwinąć drzewo).
 */
export function expandScheduleRowsStep(
  inventory: ScheduleCollapseInventory,
  currentLevel: ScheduleRevealLevel,
): { collapsed: Set<string>; revealLevel: ScheduleRevealLevel } {
  const nextLevel: ScheduleRevealLevel =
    currentLevel >= 2 ? 2 : ((currentLevel + 1) as ScheduleRevealLevel);

  const collapsed = new Set<string>();
  if (nextLevel <= 0) {
    for (const k of inventory.categoryKeys) collapsed.add(k);
    for (const k of inventory.subcategoryKeys) collapsed.add(k);
  } else if (nextLevel === 1) {
    // Podkategorie widoczne, zakresy pod nimi zwinięte.
    for (const k of inventory.subcategoryKeys) collapsed.add(k);
  }
  // level 2: nothing collapsed

  saveScheduleCollapseState(collapsed, nextLevel);
  return { collapsed, revealLevel: nextLevel };
}

export function nextExpandStepLabel(level: ScheduleRevealLevel): string {
  if (level <= 0) return "Rozwiń podkategorie";
  if (level === 1) return "Rozwiń zakresy";
  return "Wszystko rozwinięte";
}

/** Minimal shape used by board collapse filtering. */
export type CollapseFilterRow = {
  id: string;
  section?: boolean;
  docLane?: boolean;
  categoryLane?: boolean;
  subcategory?: boolean;
  /** Zakres przypięty do wiersza inwestycji (nie pod kategorią). */
  projectLevel?: boolean;
  categoryId?: string;
  projectId?: string;
  parentId?: string | null;
  crew?: unknown;
  blocks?: Array<{ id: string }>;
};

/**
 * Filters timeline rows according to project / category / subcategory
 * collapse keys and revealLevel.
 */
export function filterCollapsedBoardRows<T extends CollapseFilterRow>(
  rows: T[],
  collapsedKeys: Set<string>,
  revealLevel: ScheduleRevealLevel,
): T[] {
  const out: T[] = [];
  let hideUnderProject = false;
  let hideUnderCategory = false;
  let hideUnderSubId: string | null = null;

  for (const row of rows) {
    if (row.section) {
      const isProjectHeader = Boolean(
        row.projectId && !row.crew && !row.docLane,
      );
      if (isProjectHeader) {
        hideUnderProject = collapsedKeys.has(
          projectCollapseKey(row.projectId!),
        );
        hideUnderCategory = false;
        hideUnderSubId = null;
        out.push(row);
        continue;
      }
      if (row.crew) {
        hideUnderProject = false;
        hideUnderCategory = false;
        hideUnderSubId = null;
        out.push(row);
        continue;
      }
      // Dokumentacja / inne sekcje pod inwestycją
      if (hideUnderProject) continue;
      hideUnderCategory = false;
      hideUnderSubId = null;
      out.push(row);
      continue;
    }

    if (hideUnderProject) continue;

    // Zakresy „Bez kategorii” — widać od razu pod inwestycją, niezależnie
    // od poziomu zwinięcia kategorii/podkategorii.
    if (row.projectLevel) {
      out.push(row);
      continue;
    }

    if (row.categoryLane && row.projectId && row.categoryId) {
      const key = categoryCollapseKey(row.projectId, row.categoryId);
      hideUnderCategory = revealLevel <= 0 || collapsedKeys.has(key);
      hideUnderSubId = null;
      out.push(row);
      continue;
    }
    if (hideUnderCategory) continue;

    if (row.subcategory) {
      if (revealLevel < 1) continue;
      const subId = row.blocks?.[0]?.id ?? row.id;
      const subKey = subcategoryCollapseKey(subId);
      hideUnderSubId =
        revealLevel < 2 || collapsedKeys.has(subKey) ? subId : null;
      out.push(row);
      continue;
    }

    // Zakresy (works) + placeholdery
    if (revealLevel < 2) continue;
    if (hideUnderSubId && row.parentId === hideUnderSubId) continue;
    out.push(row);
  }
  return out;
}

/** @deprecated kept for older imports */
export function loadCollapsedScheduleRows(): Set<string> {
  return loadScheduleCollapseState().collapsed;
}

export function saveCollapsedScheduleRows(keys: Set<string>) {
  const { revealLevel } = loadScheduleCollapseState();
  saveScheduleCollapseState(keys, revealLevel);
}
