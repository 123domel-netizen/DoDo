import { CLIENT_BUILD_VERSION } from "@/lib/appVersion";
import {
  clientBuildPipelineLabel,
  isR2PreviewSurface,
} from "@/lib/media/previewSurface";
import type { UploadRouteLabel } from "@/lib/media/pipelinePolicy";

/** Bezpieczny snapshot diagnostyki uploadu galerii (preview) — bez sekretów / URL / plików. */
export interface MediaUploadDiagSnapshot {
  buildId: string;
  buildPipeline: "r2" | "legacy";
  teamPipeline: string | null;
  plannedUploadRoute: string | null;
  galleryId: string | null;
  serverGalleryPipeline: string | null;
  selectedUploadRoute: UploadRouteLabel | string | null;
  nextAction: string | null;
  lastMediaAction: string | null;
  updatedAt: string;
}

const STORAGE_KEY = "dodo.mediaUploadDiag.v1";

function emptySnapshot(): MediaUploadDiagSnapshot {
  return {
    buildId: CLIENT_BUILD_VERSION,
    buildPipeline: clientBuildPipelineLabel(),
    teamPipeline: null,
    plannedUploadRoute: null,
    galleryId: null,
    serverGalleryPipeline: null,
    selectedUploadRoute: null,
    nextAction: null,
    lastMediaAction: null,
    updatedAt: new Date().toISOString(),
  };
}

let snapshot: MediaUploadDiagSnapshot = emptySnapshot();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      // ignore
    }
  }
  if (typeof sessionStorage !== "undefined" && isR2PreviewSurface()) {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // quota / private mode
    }
  }
}

export function subscribeMediaUploadDiag(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMediaUploadDiag(): MediaUploadDiagSnapshot {
  return { ...snapshot };
}

/** Reset przy otwarciu dialogu — zachowuje buildId / buildPipeline. */
export function resetMediaUploadDiag(partial?: Partial<MediaUploadDiagSnapshot>): void {
  snapshot = {
    ...emptySnapshot(),
    ...partial,
    buildId: CLIENT_BUILD_VERSION,
    buildPipeline: clientBuildPipelineLabel(),
    updatedAt: new Date().toISOString(),
  };
  notify();
}

export function patchMediaUploadDiag(partial: Partial<MediaUploadDiagSnapshot>): void {
  snapshot = {
    ...snapshot,
    ...partial,
    buildId: CLIENT_BUILD_VERSION,
    buildPipeline: clientBuildPipelineLabel(),
    updatedAt: new Date().toISOString(),
  };
  notify();
}

export function recordLastMediaAction(action: string): void {
  if (!isR2PreviewSurface()) {
    // Nadal aktualizuj in-memory (testy); sessionStorage tylko na preview.
  }
  snapshot = {
    ...snapshot,
    lastMediaAction: action,
    updatedAt: new Date().toISOString(),
  };
  notify();
  if (isR2PreviewSurface()) {
    console.info("[media-pipeline]", {
      galleryId: snapshot.galleryId,
      buildPipeline: snapshot.buildPipeline,
      galleryPipeline: snapshot.serverGalleryPipeline,
      selectedUploadRoute: snapshot.selectedUploadRoute,
      nextAction: snapshot.nextAction,
      lastMediaAction: action,
    });
  }
}

/**
 * Tekst do schowka — wyłącznie bezpieczne pola diagnostyczne.
 * Bez signed URL, query, tokenów, Authorization, sekretów, nazw/zawartości plików.
 */
export function formatMediaUploadDiagForCopy(s: MediaUploadDiagSnapshot = snapshot): string {
  const lines = [
    "DoDo media upload diagnostics (safe)",
    `Build ID: ${s.buildId}`,
    `Build pipeline: ${s.buildPipeline}`,
    `Team pipeline: ${s.teamPipeline ?? "—"}`,
    `Planned upload route: ${s.plannedUploadRoute ?? "—"}`,
    `Gallery ID: ${s.galleryId ?? "—"}`,
    `Server gallery pipeline: ${s.serverGalleryPipeline ?? "—"}`,
    `Selected upload route: ${s.selectedUploadRoute ?? "—"}`,
    `Next action: ${s.nextAction ?? "—"}`,
    `Last media action: ${s.lastMediaAction ?? "—"}`,
    `Updated at: ${s.updatedAt}`,
  ];
  return lines.join("\n");
}

export function plannedRouteFromTeamPipeline(
  teamPipeline: string | null | undefined,
  buildPipeline: "r2" | "legacy",
): string {
  const team = (teamPipeline ?? "").trim();
  if (team === "r2_sp" && buildPipeline === "r2") return "R2 (pending gallery_create)";
  if (team === "r2_sp" && buildPipeline !== "r2") return "BLOCKED (build lacks R2)";
  if (team === "legacy_sp") return "Legacy SharePoint (pending gallery_create)";
  return "unknown (pending gallery_create)";
}

export function nextActionForGalleryPipeline(pipeline: string | null | undefined): string {
  const p = (pipeline ?? "").trim();
  if (p === "r2_sp") return "r2_presign_gallery_items";
  if (p === "legacy_sp") return "gallery_upload_item";
  return "blocked (invalid gallery.pipeline)";
}
