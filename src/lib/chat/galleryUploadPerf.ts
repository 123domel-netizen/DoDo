/**
 * Pomiary etapów uploadu galerii — log `[gallery-perf]` w konsoli.
 * Nie zmienia zachowania; służy do porównania przed/po optymalizacji.
 */

export type GalleryPerfStage =
  | "read_file"
  | "decode"
  | "scale_main"
  | "scale_thumb"
  | "prepare_total"
  | "gallery_create"
  | "base64_encode"
  | "upload_http"
  | "upload_item_total"
  | "pipeline_total";

const enabled =
  typeof import.meta !== "undefined" &&
  (import.meta.env?.DEV === true || import.meta.env?.VITE_GALLERY_PERF === "1");

type Sample = { stage: GalleryPerfStage; ms: number; detail?: string };

const samples: Sample[] = [];

export function galleryPerfEnabled(): boolean {
  return Boolean(enabled);
}

export function galleryPerfReset(): void {
  samples.length = 0;
}

export function galleryPerfMark(
  stage: GalleryPerfStage,
  startedAt: number,
  detail?: string,
): number {
  const ms = Math.round(performance.now() - startedAt);
  if (enabled) {
    samples.push({ stage, ms, detail });
    const suffix = detail ? ` ${detail}` : "";
    console.info(`[gallery-perf] ${stage}: ${ms}ms${suffix}`);
  }
  return ms;
}

export function galleryPerfSummary(label: string): void {
  if (!enabled || samples.length === 0) return;
  const byStage = new Map<string, number[]>();
  for (const s of samples) {
    const arr = byStage.get(s.stage) ?? [];
    arr.push(s.ms);
    byStage.set(s.stage, arr);
  }
  const lines = [`[gallery-perf] === ${label} ===`];
  for (const [stage, arr] of byStage) {
    const sum = arr.reduce((a, b) => a + b, 0);
    const avg = Math.round(sum / arr.length);
    const max = Math.max(...arr);
    lines.push(`  ${stage}: n=${arr.length} sum=${sum}ms avg=${avg}ms max=${max}ms`);
  }
  console.info(lines.join("\n"));
}

export function galleryPerfNow(): number {
  return performance.now();
}
