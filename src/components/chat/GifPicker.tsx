import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { isGifUrl } from "@/lib/chat/markdown";

/**
 * CHAT5-GIF: GIF-y bez przechowywania w DoDo — zapisujemy tylko URL
 * zewnętrznego dostawcy. Z kluczem Tenor (VITE_TENOR_API_KEY) — wyszukiwarka;
 * bez klucza — wklejenie linku do GIF-a.
 */

const TENOR_KEY = (import.meta.env.VITE_TENOR_API_KEY as string | undefined) ?? "";

interface TenorGif {
  id: string;
  url: string;
  previewUrl: string;
}

async function searchTenor(query: string, signal: AbortSignal): Promise<TenorGif[]> {
  const params = new URLSearchParams({
    key: TENOR_KEY,
    q: query || "trending",
    limit: "24",
    media_filter: "gif,tinygif",
    contentfilter: "medium",
    locale: "pl_PL",
  });
  const endpoint = query
    ? `https://tenor.googleapis.com/v2/search?${params}`
    : `https://tenor.googleapis.com/v2/featured?${params}`;
  const res = await fetch(endpoint, { signal });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    results?: {
      id: string;
      media_formats?: Record<string, { url?: string }>;
    }[];
  };
  return (json.results ?? [])
    .map((r) => ({
      id: r.id,
      url: r.media_formats?.gif?.url ?? "",
      previewUrl: r.media_formats?.tinygif?.url ?? r.media_formats?.gif?.url ?? "",
    }))
    .filter((g) => g.url);
}

interface GifPickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (url: string) => void;
}

export function GifPicker({ open, onClose, onPick }: GifPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TenorGif[]>([]);
  const [loading, setLoading] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open || !TENOR_KEY) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    const t = setTimeout(() => {
      searchTenor(query.trim(), ctrl.signal)
        .then((r) => setResults(r))
        .catch(() => undefined)
        .finally(() => setLoading(false));
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, query]);

  if (!open) return null;

  const pick = (url: string) => {
    onPick(url);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/50"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div className="relative flex max-h-[75vh] w-full max-w-md flex-col rounded-t-2xl border border-line bg-surface-overlay p-3 shadow-pop sm:rounded-2xl">
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-sm font-semibold text-ink">GIF</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint transition hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={16} />
          </button>
        </div>

        {TENOR_KEY ? (
          <>
            <div className="relative mb-2">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Szukaj GIF-ów (Tenor)…"
                className="w-full rounded-lg border border-line bg-surface-raised py-1.5 pl-8 pr-3 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50"
              />
            </div>
            <div className="thin-scrollbar grid min-h-[10rem] flex-1 grid-cols-3 gap-1.5 overflow-y-auto">
              {loading && (
                <div className="col-span-3 py-8 text-center text-xs text-ink-faint">
                  Szukam…
                </div>
              )}
              {!loading &&
                results.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => pick(g.url)}
                    className="overflow-hidden rounded-lg border border-line bg-surface-raised"
                  >
                    <img
                      src={g.previewUrl}
                      alt="GIF"
                      loading="lazy"
                      className="h-24 w-full object-cover"
                    />
                  </button>
                ))}
              {!loading && !results.length && (
                <div className="col-span-3 py-8 text-center text-xs text-ink-faint">
                  Brak wyników.
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2 p-1">
            <p className="text-xs leading-relaxed text-ink-faint">
              Wklej link do GIF-a (np. z Tenor / GIPHY — „Kopiuj adres GIF-a").
              Plik pozostaje u dostawcy; DoDo zapisuje tylko link.
            </p>
            <input
              value={pasteUrl}
              onChange={(e) => setPasteUrl(e.target.value)}
              placeholder="https://media.tenor.com/….gif"
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50"
            />
            <button
              type="button"
              disabled={!isGifUrl(pasteUrl.trim())}
              onClick={() => pick(pasteUrl.trim())}
              className="w-full rounded-xl bg-accent-grad py-2 text-sm font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
            >
              Wyślij GIF
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
