const STORAGE_KEY = "dodo-schedule-row-collapse-v1";

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

/** Zwiń wszystko do nagłówków kategorii. */
export function collapseAllScheduleRows(
  inventory: ScheduleCollapseInventory,
): { collapsed: Set<string>; revealLevel: ScheduleRevealLevel } {
  const collapsed = new Set<string>([
    ...inventory.categoryKeys,
    ...inventory.subcategoryKeys,
  ]);
  const revealLevel: ScheduleRevealLevel = 0;
  saveScheduleCollapseState(collapsed, revealLevel);
  return { collapsed, revealLevel };
}

/**
 * Kolejne kliknięcie rozwijania: 0→1 podkategorie, 1→2 zakresy.
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

/** @deprecated kept for older imports */
export function loadCollapsedScheduleRows(): Set<string> {
  return loadScheduleCollapseState().collapsed;
}

export function saveCollapsedScheduleRows(keys: Set<string>) {
  const { revealLevel } = loadScheduleCollapseState();
  saveScheduleCollapseState(keys, revealLevel);
}
