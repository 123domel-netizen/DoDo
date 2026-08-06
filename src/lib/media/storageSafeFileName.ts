/**
 * Object-key-safe filename for Supabase Storage / S3-style keys.
 * Non-ASCII (e.g. Polish diacritics) is transliterated; other junk → `_`.
 */
export function storageSafeFileName(name: string): string {
  const trimmed = name.trim() || "plik";
  const lastDot = trimmed.lastIndexOf(".");
  const hasExt =
    lastDot > 0 &&
    lastDot < trimmed.length - 1 &&
    trimmed.length - lastDot <= 9;
  const rawStem = hasExt ? trimmed.slice(0, lastDot) : trimmed;
  const rawExt = hasExt ? trimmed.slice(lastDot + 1) : "";

  const stem = asciiSlug(rawStem).slice(0, 72) || "plik";
  const ext = asciiSlug(rawExt).replace(/_/g, "").slice(0, 8);
  return ext ? `${stem}.${ext}` : stem;
}

function asciiSlug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}
