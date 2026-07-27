/**
 * Detect #project query at caret — mirrors mentions.ts pattern for preview sandbox.
 */

export type ProjectQuery = {
  start: number;
  end: number;
  query: string;
};

export function projectQueryAt(text: string, caret: number): ProjectQuery | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|[\s([{])#([^\s#]*)$/);
  if (!m) return null;
  const query = m[2] ?? "";
  const start = before.length - query.length - 1;
  return { start, end: caret, query };
}

export function applyProjectRef(
  text: string,
  _caret: number,
  query: ProjectQuery,
  label: string,
): { text: string; caret: number } {
  const insert = `${label} `;
  const next = text.slice(0, query.start) + insert + text.slice(query.end);
  return { text: next, caret: query.start + insert.length };
}
