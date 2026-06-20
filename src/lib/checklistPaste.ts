/** Linia z godziną z czatu (np. „Pon, 11:50”) — pomijamy przy wklejaniu listy. */
const TIMESTAMP_LINE =
  /^(?:Pon|Wt|Śr|Czw|Pt|So|Nd|Poniedziałek|Wtorek|Środa|Czwartek|Piątek|Sobota|Niedziela|Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:,\s*|\s+)\d{1,2}:\d{2}\s*$/i;

function isTimestampLine(line: string): boolean {
  return TIMESTAMP_LINE.test(line.trim());
}

function stripBullet(line: string): string | null {
  const trimmed = line.trim();
  const withSpace = trimmed.match(/^[-–—*•]\s+(.+)$/);
  if (withSpace) return withSpace[1].trim();
  const tight = trimmed.match(/^[-–—*•](\S.+)$/);
  if (tight) return tight[1].trim();
  const numbered = trimmed.match(/^\d+[.)]\s*(.+)$/);
  if (numbered) return numbered[1].trim();
  return null;
}

function splitCommaLine(line: string): string[] {
  return line
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** „mleko mąka 12 jajek” → osobne pozycje; liczby łączymy z następnym słowem. */
function splitSpaceSeparated(line: string): string[] {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return tokens;

  const parts: string[] = [];
  let current = "";

  for (const token of tokens) {
    const isQty = /^\d+(?:[x×])?$/i.test(token);
    if (isQty) {
      if (current && !/^\d+/.test(current)) {
        parts.push(current.trim());
      }
      current = token;
      continue;
    }
    if (current && /^\d+/.test(current)) {
      current += ` ${token}`;
      continue;
    }
    if (current) {
      parts.push(current.trim());
    }
    current = token;
  }
  if (current) parts.push(current.trim());
  return parts;
}

function parseLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed || isTimestampLine(trimmed)) return [];

  const bullet = stripBullet(trimmed);
  if (bullet) return [bullet];

  if (trimmed.includes(",")) return splitCommaLine(trimmed);

  return [trimmed];
}

/** Zamienia wklejony tekst listy zakupów na osobne punkty checklisty. */
export function parseChecklistPaste(raw: string): string[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const lines = text.split("\n").map((l) => l.trim());

  if (lines.length === 1) {
    const line = lines[0];
    if (line.includes(",")) return splitCommaLine(line);
    const bullet = stripBullet(line);
    if (bullet) return [bullet];
    return splitSpaceSeparated(line);
  }

  const items: string[] = [];
  for (const line of lines) {
    items.push(...parseLine(line));
  }
  return items.filter(Boolean);
}

export function shouldParseChecklistPaste(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\n/.test(t)) return true;
  if (t.includes(",")) return true;
  if (/^[-–—*•]/.test(t)) return true;
  if (/^\d+[.)]\s/.test(t)) return true;
  return parseChecklistPaste(t).length > 1;
}
