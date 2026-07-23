import { CLIENT_BUILD_VERSION } from "@/lib/appVersion";
import { clientBuildAllowsR2 } from "@/lib/media/pipelinePolicy";

/**
 * Powierzchnia R2 PREVIEW:
 * 1) build z `VITE_MEDIA_PIPELINE=r2` (preview Pages / lokalnie) — niezależnie od hosta
 *    (unikalny URL deploymentu też działa),
 * 2) albo host aliasu `media-r2-preview.*`.
 *
 * Produkcja budowana BEZ VITE=r2 → nigdy nie pokazuje banneru/diag.
 */
export function isR2PreviewSurface(): boolean {
  if (clientBuildAllowsR2(import.meta.env.VITE_MEDIA_PIPELINE as string | undefined)) {
    return true;
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname.toLowerCase();
    if (host.startsWith("media-r2-preview.")) return true;
  }
  return false;
}

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
