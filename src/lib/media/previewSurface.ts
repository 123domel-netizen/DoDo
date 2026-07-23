import { CLIENT_BUILD_VERSION } from "@/lib/appVersion";
import { clientBuildAllowsR2 } from "@/lib/media/pipelinePolicy";

/**
 * Diagnostyka / banner „R2 PREVIEW” — NIGDY na produkcji (`dodo-c39.pages.dev`).
 *
 * Widoczne tylko gdy host:
 * - `media-r2-preview.*`, albo
 * - `localhost` / `127.0.0.1` (dev lokalny).
 *
 * `VITE_MEDIA_PIPELINE=r2` na produkcyjnym Pages NIE włącza bannera —
 * służy wyłącznie do direct PUT (`clientBuildPipelineLabel`).
 */
export function isR2PreviewSurface(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.toLowerCase();
  if (host.startsWith("media-r2-preview.")) return true;
  if (host === "localhost" || host === "127.0.0.1") return true;
  return false;
}

/** Etykieta buildu: czy klient potrafi R2 (prod + preview z VITE=r2). */
export function clientBuildPipelineLabel(): "r2" | "legacy" {
  return clientBuildAllowsR2(import.meta.env.VITE_MEDIA_PIPELINE as string | undefined)
    ? "r2"
    : "legacy";
}

export function mediaPreviewDiagnostics(): {
  banner: boolean;
  buildId: string;
  buildPipeline: "r2" | "legacy";
  host: string;
} {
  return {
    banner: isR2PreviewSurface(),
    buildId: CLIENT_BUILD_VERSION,
    buildPipeline: clientBuildPipelineLabel(),
    host: typeof window !== "undefined" ? window.location.hostname : "",
  };
}

/** Bezpieczny log preview — bez URL, tokenów, query stringów. */
export function logMediaPipelineDiag(input: {
  galleryId: string;
  buildPipeline: "r2" | "legacy";
  galleryPipeline: string;
  selectedUploadRoute: "R2" | "Legacy SharePoint";
}): void {
  if (!isR2PreviewSurface()) return;
  console.info("[media-pipeline]", {
    galleryId: input.galleryId,
    buildPipeline: input.buildPipeline,
    galleryPipeline: input.galleryPipeline,
    selectedUploadRoute: input.selectedUploadRoute,
  });
}
