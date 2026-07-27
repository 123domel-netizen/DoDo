import { kindFromLabel, type ProjectKind } from "./types";

export type BulkRowOk = {
  ok: true;
  line: number;
  number: number;
  name: string;
  kind: ProjectKind;
  raw: string;
};

export type BulkRowErr = {
  ok: false;
  line: number;
  raw: string;
  error:
    | "missing_name"
    | "invalid_number"
    | "unknown_kind"
    | "duplicate_in_import"
    | "number_exists";
  number?: number;
  name?: string;
  kind?: ProjectKind | null;
};

export type BulkRow = BulkRowOk | BulkRowErr;

export type BulkParseResult = {
  rows: BulkRow[];
  okCount: number;
  errorCount: number;
};

/**
 * Mode A: `114; Vestino - Więcbork; Nadzór budowy`
 * Mode B: `114 Vestino - Więcbork` (+ shared kind)
 */
export function parseBulkProjects(
  text: string,
  opts: {
    mode: "a" | "b";
    sharedKind?: ProjectKind;
    existingNumbers: Set<number>;
  },
): BulkParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const seen = new Set<number>();
  const rows: BulkRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = i + 1;

    if (opts.mode === "a") {
      const parts = raw.split(";").map((p) => p.trim());
      if (parts.length < 2) {
        rows.push({ ok: false, line, raw, error: "missing_name" });
        continue;
      }
      const num = Number(parts[0]);
      const name = parts[1] ?? "";
      const kindRaw = parts[2] ?? "";
      if (!Number.isInteger(num) || num <= 0) {
        rows.push({ ok: false, line, raw, error: "invalid_number", name });
        continue;
      }
      if (!name.trim()) {
        rows.push({
          ok: false,
          line,
          raw,
          error: "missing_name",
          number: num,
        });
        continue;
      }
      const kind = kindFromLabel(kindRaw);
      if (!kind) {
        rows.push({
          ok: false,
          line,
          raw,
          error: "unknown_kind",
          number: num,
          name,
          kind: null,
        });
        continue;
      }
      if (seen.has(num)) {
        rows.push({
          ok: false,
          line,
          raw,
          error: "duplicate_in_import",
          number: num,
          name,
          kind,
        });
        continue;
      }
      if (opts.existingNumbers.has(num)) {
        rows.push({
          ok: false,
          line,
          raw,
          error: "number_exists",
          number: num,
          name,
          kind,
        });
        continue;
      }
      seen.add(num);
      rows.push({ ok: true, line, raw, number: num, name: name.trim(), kind });
      continue;
    }

    // Mode B: number + rest as name
    const m = raw.match(/^(\d+)\s+(.+)$/);
    if (!m) {
      rows.push({ ok: false, line, raw, error: "invalid_number" });
      continue;
    }
    const num = Number(m[1]);
    const name = (m[2] ?? "").trim();
    if (!Number.isInteger(num) || num <= 0) {
      rows.push({ ok: false, line, raw, error: "invalid_number", name });
      continue;
    }
    if (!name) {
      rows.push({ ok: false, line, raw, error: "missing_name", number: num });
      continue;
    }
    const kind = opts.sharedKind ?? null;
    if (!kind) {
      rows.push({
        ok: false,
        line,
        raw,
        error: "unknown_kind",
        number: num,
        name,
        kind: null,
      });
      continue;
    }
    if (seen.has(num)) {
      rows.push({
        ok: false,
        line,
        raw,
        error: "duplicate_in_import",
        number: num,
        name,
        kind,
      });
      continue;
    }
    if (opts.existingNumbers.has(num)) {
      rows.push({
        ok: false,
        line,
        raw,
        error: "number_exists",
        number: num,
        name,
        kind,
      });
      continue;
    }
    seen.add(num);
    rows.push({ ok: true, line, raw, number: num, name, kind });
  }

  return {
    rows,
    okCount: rows.filter((r) => r.ok).length,
    errorCount: rows.filter((r) => !r.ok).length,
  };
}
