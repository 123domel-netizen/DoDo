/** Id bazowego itemu (bez sufiksu wystąpienia powtarzalnego). */
export function baseItemId(id: string): string {
  const sep = id.indexOf("__");
  return sep >= 0 ? id.slice(0, sep) : id;
}

export function isOccurrenceId(id: string): boolean {
  return id.includes("__");
}
