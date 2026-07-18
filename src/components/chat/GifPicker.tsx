import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link2, Search, X } from "lucide-react";
import { isGifUrl } from "@/lib/chat/markdown";

/**
 * CHAT5-GIF / CHAT6: GIF-y jak w Messengerze — wyszukiwarka z siatką i wysyłką
 * jednym kliknięciem, działa bez żadnej konfiguracji. Pliki zostają u dostawcy;
 * DoDo zapisuje wyłącznie URL.
 *
 * Dostawcy (pierwszy dostępny):
 *  1. Tenor  — gdy ustawiono VITE_TENOR_API_KEY,
 *  2. GIPHY  — VITE_GIPHY_API_KEY albo publiczny klucz z przykładów
 *     dokumentacji GIPHY (limitowany; przy większym użyciu warto podmienić
 *     na własny darmowy klucz).
 */

const TENOR_KEY = (import.meta.env.VITE_TENOR_API_KEY as string | undefined) ?? "";
// Publiczny klucz z oficjalnych przykładów dokumentacji GIPHY (web SDK demo).
const GIPHY_PUBLIC_DOCS_KEY = "GlVGYHkr3WSBnllca54iNt0yFbjz7L65";
const GIPHY_KEY =
  ((import.meta.env.VITE_GIPHY_API_KEY as string | undefined) ?? "") ||
  GIPHY_PUBLIC_DOCS_KEY;

interface GifResult {
  id: string;
  /** URL wysyłany w wiadomości. */
  url: string;
  /** Lżejszy podgląd do siatki. */
  previewUrl: string;
}

async function searchTenor(query: string, signal: AbortSignal): Promise<GifResult[]> {
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
  if (!res.ok) throw new Error(`tenor ${res.status}`);
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

async function searchGiphy(query: string, signal: AbortSignal): Promise<GifResult[]> {
  const params = new URLSearchParams({
    api_key: GIPHY_KEY,
    limit: "24",
    rating: "pg-13",
    lang: "pl",
  });
  if (query) params.set("q", query);
  const endpoint = query
    ? `https://api.giphy.com/v1/gifs/search?${params}`
    : `https://api.giphy.com/v1/gifs/trending?${params}`;
  const res = await fetch(endpoint, { signal });
  if (!res.ok) throw new Error(`giphy ${res.status}`);
  const json = (await res.json()) as {
    data?: {
      id: string;
      images?: Record<string, { url?: string }>;
    }[];
  };
  return (json.data ?? [])
    .map((r) => ({
      id: r.id,
      url: r.images?.fixed_height?.url ?? r.images?.original?.url ?? "",
      previewUrl:
        r.images?.fixed_width?.url ??
        r.images?.fixed_height_small?.url ??
        r.images?.original?.url ??
        "",
    }))
    .filter((g) => g.url);
}

function searchGifs(query: string, signal: AbortSignal): Promise<GifResult[]> {
  return TENOR_KEY ? searchTenor(query, signal) : searchGiphy(query, signal);
}

interface GifPickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (url: string) => void;
}

export function GifPicker({ open, onClose, onPick }: GifPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    const t = setTimeout(
      () => {
        searchGifs(query.trim(), ctrl.signal)
          .then((r) => {
            setResults(r);
            setFailed(false);
          })
          .catch((err: unknown) => {
            if ((err as Error)?.name !== "AbortError") setFailed(true);
          })
          .finally(() => setLoading(false));
      },
      query ? 350 : 0,
    );
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setPasteUrl("");
      // Autofocus tylko tam, gdzie nie wywoła klawiatury zasłaniającej siatkę.
      if (window.matchMedia("(min-width: 640px)").matches) {
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    }
  }, [open]);

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
      <div className="relative flex h-[70vh] w-full max-w-md flex-col rounded-t-2xl border border-line bg-surface-overlay p-3 shadow-pop sm:h-[75vh] sm:rounded-2xl">
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-sm font-semibold text-ink">
            GIF{" "}
            <span className="text-[10px] font-normal text-ink-faint">
              {TENOR_KEY ? "Tenor" : "GIPHY"}
            </span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint transition hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative mb-2">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Szukaj GIF-ów…"
            className="w-full rounded-lg border border-line bg-surface-raised py-1.5 pl-8 pr-3 text-sm text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50"
          />
        </div>

        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
          {loading && (
            <div className="py-8 text-center text-xs text-ink-faint">Szukam…</div>
          )}
          {!loading && failed && (
            <div className="px-4 py-8 text-center text-xs leading-relaxed text-ink-faint">
              Wyszukiwarka GIF-ów jest chwilowo niedostępna.
              <br />
              Możesz wkleić link do GIF-a poniżej.
            </div>
          )}
          {!loading && !failed && (
            <div className="columns-2 gap-1.5 [column-fill:balance]">
              {results.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => pick(g.url)}
                  className="mb-1.5 block w-full overflow-hidden rounded-lg border border-line bg-surface-raised transition hover:border-accent/60"
                  aria-label="Wyślij tego GIF-a"
                >
                  <img
                    src={g.previewUrl}
                    alt="GIF"
                    loading="lazy"
                    className="w-full object-cover"
                  />
                </button>
              ))}
              {!results.length && (
                <div className="col-span-2 py-8 text-center text-xs text-ink-faint">
                  Brak wyników.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center gap-1.5 border-t border-line pt-2">
          <Link2 size={13} className="shrink-0 text-ink-faint" />
          <input
            value={pasteUrl}
            onChange={(e) => setPasteUrl(e.target.value)}
            placeholder="…albo wklej link do GIF-a"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-xs text-ink outline-none transition placeholder:text-ink-faint focus:border-accent/50"
          />
          <button
            type="button"
            disabled={!isGifUrl(pasteUrl.trim())}
            onClick={() => pick(pasteUrl.trim())}
            className="shrink-0 rounded-lg bg-accent-grad px-3 py-1.5 text-xs font-medium text-white shadow-glow transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
          >
            Wyślij
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
