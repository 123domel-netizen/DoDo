export type BulkRowOk = {
  ok: true;
  line: number;
  number: string;
  name: string;
  raw: string;
};

export type BulkRowErr = {
  ok: false;
  line: number;
  raw: string;
  error:
    | "missing_name"
    | "invalid_number"
    | "duplicate_in_import"
    | "number_exists";
  number?: string;
  name?: string;
};

export type BulkRow = BulkRowOk | BulkRowErr;

export type BulkParseResult = {
  rows: BulkRow[];
  okCount: number;
  errorCount: number;
};

/**
 * Parse lines as `114 Vestino - Więcbork`, `B-12; Vestino` (any non-empty code).
 */
export function parseBulkProjects(
  text: string,
  opts: { existingNumbers: Set<string> },
): BulkParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const seen = new Set<string>();
  const rows: BulkRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = i + 1;

    let code: string;
    let name: string;

    if (raw.includes(";")) {
      const parts = raw.split(";").map((p) => p.trim());
      code = (parts[0] ?? "").trim();
      name = parts[1] ?? "";
    } else {
      const m = raw.match(/^(\S+)\s+(.+)$/);
      if (!m) {
        rows.push({ ok: false, line, raw, error: "invalid_number" });
        continue;
      }
      code = (m[1] ?? "").trim();
      name = (m[2] ?? "").trim();
    }

    if (!code) {
      rows.push({ ok: false, line, raw, error: "invalid_number", name });
      continue;
    }
    if (!name.trim()) {
      rows.push({
        ok: false,
        line,
        raw,
        error: "missing_name",
        number: code,
      });
      continue;
    }
    name = name.trim();
    const key = code.toLowerCase();
    if (seen.has(key)) {
      rows.push({
        ok: false,
        line,
        raw,
        error: "duplicate_in_import",
        number: code,
        name,
      });
      continue;
    }
    if (opts.existingNumbers.has(key)) {
      rows.push({
        ok: false,
        line,
        raw,
        error: "number_exists",
        number: code,
        name,
      });
      continue;
    }
    seen.add(key);
    rows.push({ ok: true, line, raw, number: code, name });
  }

  return {
    rows,
    okCount: rows.filter((r) => r.ok).length,
    errorCount: rows.filter((r) => !r.ok).length,
  };
}
