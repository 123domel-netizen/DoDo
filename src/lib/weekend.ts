/** Stonowane tło weekendu — token CSS dopasowany do motywu. */
export function weekendColumnBg(day: Date): string | undefined {
  const w = day.getDay(); // 0 = niedziela, 6 = sobota
  if (w === 6) return "var(--weekend-sat)";
  if (w === 0) return "var(--weekend-sun)";
  return undefined;
}

/** Węższe kolumny w weekend — waga w układzie siatki. */
export function dayColumnWeight(day: Date): number {
  const w = day.getDay();
  if (w === 6 || w === 0) return 0.52;
  return 1;
}

export interface DayColumnSlot {
  leftPct: number;
  widthPct: number;
}

/** Pozycje kolumn o zmiennej szerokości (dni robocze szersze, weekend węższy). */
export function dayColumnLayout(days: Date[]): DayColumnSlot[] {
  const weights = days.map(dayColumnWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return weights.map((w) => {
    const widthPct = (w / total) * 100;
    const leftPct = (acc / total) * 100;
    acc += w;
    return { leftPct, widthPct };
  });
}

/** Zakres kolumn [startIdx..endIdx] w układzie procentowym. */
export function spanColumnLayout(
  layout: DayColumnSlot[],
  startIdx: number,
  endIdx: number,
): DayColumnSlot {
  const start = layout[startIdx];
  const end = layout[endIdx];
  return {
    leftPct: start.leftPct,
    widthPct: end.leftPct + end.widthPct - start.leftPct,
  };
}

/** Indeks kolumny z pozycji X (0..1) w siatce. */
export function dayIndexAtX(relativeX: number, layout: DayColumnSlot[]): number {
  const pct = relativeX * 100;
  for (let i = 0; i < layout.length; i++) {
    const col = layout[i];
    if (pct < col.leftPct + col.widthPct || i === layout.length - 1) return i;
  }
  return layout.length - 1;
}
