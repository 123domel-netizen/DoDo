import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  formatMediaUploadDiagForCopy,
  getMediaUploadDiag,
  subscribeMediaUploadDiag,
  type MediaUploadDiagSnapshot,
} from "@/lib/media/mediaUploadDiag";
import { isR2PreviewSurface } from "@/lib/media/previewSurface";

/** Trwały panel diagnostyki w dialogu galerii — tylko R2 PREVIEW / lokalny VITE=r2. */
export function GalleryMediaDiagPanel({ phase }: { phase: "form" | "post-create" }) {
  const [snap, setSnap] = useState<MediaUploadDiagSnapshot>(() => getMediaUploadDiag());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSnap(getMediaUploadDiag());
    return subscribeMediaUploadDiag(() => setSnap(getMediaUploadDiag()));
  }, []);

  if (!isR2PreviewSurface()) return null;

  const copy = async () => {
    const text = formatMediaUploadDiagForCopy(getMediaUploadDiag());
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="mb-2 rounded-md border-2 border-amber-400 bg-amber-950 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-amber-50"
      data-media-pipeline-diag="1"
      data-diag-phase={phase}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-sans text-[11px] font-bold tracking-wide text-amber-200">
          Media diagnostics
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="pointer-events-auto inline-flex items-center gap-1 rounded border border-amber-400/60 bg-amber-900/80 px-1.5 py-0.5 font-sans text-[10px] text-amber-50 transition hover:bg-amber-800"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Skopiowano" : "Kopiuj diagnostykę"}
        </button>
      </div>
      <div>Build ID: {snap.buildId}</div>
      <div>Build pipeline: {snap.buildPipeline}</div>
      <div>Team pipeline: {snap.teamPipeline ?? "—"}</div>
      <div>Planned upload route: {snap.plannedUploadRoute ?? "—"}</div>
      {phase === "post-create" && (
        <>
          <div className="mt-1 border-t border-amber-500/25 pt-1">Gallery ID: {snap.galleryId ?? "—"}</div>
          <div>Server gallery pipeline: {snap.serverGalleryPipeline ?? "—"}</div>
          <div>Selected upload route: {snap.selectedUploadRoute ?? "—"}</div>
          <div>Next action: {snap.nextAction ?? "—"}</div>
          <div>Last media action: {snap.lastMediaAction ?? "—"}</div>
        </>
      )}
      {phase === "form" && snap.lastMediaAction && (
        <div>Last media action: {snap.lastMediaAction}</div>
      )}
    </div>
  );
}
