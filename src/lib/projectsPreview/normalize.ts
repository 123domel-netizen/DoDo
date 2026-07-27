/** Normalize Polish text for search: strip diacritics, case, dashes, extra spaces. */
export function normalizeSearchText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/gi, "l")
    .toLowerCase()
    .replace(/[-–—_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
