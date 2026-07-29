/** Format wyświetlania dat w Harmonogramach: dzień/miesiąc/rok. */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isoToPlDate(iso: string): string {
  const m = ISO_RE.exec(iso.trim());
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Parsuje `dd/mm/rrrr` (także `.` / `-`, 1–2 cyfry dnia/miesiąca).
 * Zwraca ISO `YYYY-MM-DD` albo `null` przy błędzie.
 */
export function plDateToIso(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return iso;
}
