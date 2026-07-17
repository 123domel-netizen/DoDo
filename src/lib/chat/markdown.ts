/**
 * CHAT5-MD: Markdown lite — czysty parser (bez zależności, testowalny w node).
 * Obsługa: **pogrubienie**, *kursywa* / _kursywa_, `kod`, ~~przekreślenie~~,
 * auto-linki http(s) oraz wzmianki @Nazwa (z listy znanych nazw).
 * Bez zagnieżdżania (płaski format) — świadomie prosty, nie edytor Worda.
 */

export type MarkdownSegment =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "italic"; text: string }
  | { type: "strike"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "mention"; text: string; name: string };

export const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g;

const WORD_CHAR = /[\p{L}\p{N}_]/u;

interface Candidate {
  start: number;
  end: number;
  seg: MarkdownSegment;
  priority: number;
}

function findRegex(
  text: string,
  from: number,
  re: RegExp,
  build: (m: RegExpExecArray) => { end: number; seg: MarkdownSegment } | null,
  priority: number,
): Candidate | null {
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const built = build(m);
    if (built) return { start: m.index, end: built.end, seg: built.seg, priority };
  }
  return null;
}

/** Wzmianka @Nazwa: dopasowanie najdłuższej nazwy, granica słowa po nazwie. */
function findMention(
  text: string,
  from: number,
  namesByLength: string[],
): Candidate | null {
  for (let i = from; i < text.length; i++) {
    if (text[i] !== "@") continue;
    const rest = text.slice(i + 1);
    const restLower = rest.toLowerCase();
    for (const name of namesByLength) {
      if (!name) continue;
      if (!restLower.startsWith(name.toLowerCase())) continue;
      const after = rest[name.length];
      if (after !== undefined && WORD_CHAR.test(after)) continue;
      return {
        start: i,
        end: i + 1 + name.length,
        seg: { type: "mention", text: text.slice(i, i + 1 + name.length), name },
        priority: 5,
      };
    }
  }
  return null;
}

export function parseMarkdownLite(
  text: string,
  mentionNames: string[] = [],
): MarkdownSegment[] {
  const namesByLength = [...mentionNames]
    .filter((n) => n.trim())
    .sort((a, b) => b.length - a.length);
  const out: MarkdownSegment[] = [];
  let pos = 0;

  const pushText = (t: string) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.type === "text") last.text += t;
    else out.push({ type: "text", text: t });
  };

  while (pos < text.length) {
    const candidates: (Candidate | null)[] = [
      findRegex(
        text,
        pos,
        /`([^`\n]+)`/g,
        (m) => ({ end: m.index + m[0].length, seg: { type: "code", text: m[1] } }),
        0,
      ),
      findRegex(
        text,
        pos,
        /\*\*([^*\n]+)\*\*/g,
        (m) => ({ end: m.index + m[0].length, seg: { type: "bold", text: m[1] } }),
        1,
      ),
      findRegex(
        text,
        pos,
        /~~([^~\n]+)~~/g,
        (m) => ({ end: m.index + m[0].length, seg: { type: "strike", text: m[1] } }),
        2,
      ),
      findRegex(
        text,
        pos,
        /(?<![*\p{L}\p{N}_])\*([^*\n]+)\*(?!\*)/gu,
        (m) => ({ end: m.index + m[0].length, seg: { type: "italic", text: m[1] } }),
        3,
      ),
      findRegex(
        text,
        pos,
        /(?<![\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu,
        (m) => ({ end: m.index + m[0].length, seg: { type: "italic", text: m[1] } }),
        3,
      ),
      findRegex(
        text,
        pos,
        /https?:\/\/[^\s<>"')\]]+/g,
        (m) => ({
          end: m.index + m[0].length,
          seg: { type: "link", text: m[0], href: m[0] },
        }),
        4,
      ),
      namesByLength.length ? findMention(text, pos, namesByLength) : null,
    ];

    let best: Candidate | null = null;
    for (const c of candidates) {
      if (!c) continue;
      if (!best || c.start < best.start || (c.start === best.start && c.priority < best.priority)) {
        best = c;
      }
    }

    if (!best) {
      pushText(text.slice(pos));
      break;
    }
    pushText(text.slice(pos, best.start));
    out.push(best.seg);
    pos = best.end;
  }

  return out;
}

export function extractUrls(text: string): string[] {
  const m = text.match(URL_REGEX);
  return m ? [...new Set(m)] : [];
}

export function firstUrl(text: string): string | null {
  URL_REGEX.lastIndex = 0;
  const m = URL_REGEX.exec(text);
  return m ? m[0] : null;
}

/** Czy URL wygląda na obrazek GIF (render inline zamiast karty linku). */
export function isGifUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (/\.gif($|\?)/i.test(u.pathname + u.search)) return true;
    return /(^|\.)media\.tenor\.com$/i.test(u.hostname) || /(^|\.)giphy\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}
