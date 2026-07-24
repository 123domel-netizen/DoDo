import { useEffect, useState } from "react";

type PdfjsModule = typeof import("pdfjs-dist");

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then(async (pdfjs) => {
      const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

/** Miniatura 1. strony PDF (jak WhatsApp) — lazy, bez blokowania UI. */
export function PdfThumb({
  url,
  fileName,
  className = "",
}: {
  url: string | null;
  fileName: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setSrc(null);
    setFailed(false);
    if (!url) return;

    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        const doc = await pdfjs.getDocument({ url, withCredentials: false }).promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const targetW = 220;
        const scale = targetW / viewport.width;
        const scaled = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(scaled.width);
        canvas.height = Math.ceil(scaled.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no canvas");
        await page.render({ canvasContext: ctx, viewport: scaled }).promise;
        objectUrl = canvas.toDataURL("image/jpeg", 0.72);
        if (!cancelled) setSrc(objectUrl);
        await doc.destroy();
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed || (!src && !url)) {
    return (
      <div
        className={`flex items-center justify-center bg-red-500/10 text-[11px] font-semibold uppercase tracking-wide text-red-400 ${className}`}
      >
        PDF
      </div>
    );
  }

  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-surface-overlay text-[11px] text-ink-faint ${className}`}
      >
        PDF…
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={fileName}
      loading="lazy"
      className={`bg-white object-cover object-top ${className}`}
    />
  );
}
