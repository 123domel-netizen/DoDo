import { useEffect, useState } from "react";
import { CLIENT_BUILD_VERSION } from "@/lib/appVersion";
import { getOAuthOriginDiag, type OAuthOriginDiag } from "@/lib/auth";
import { isR2PreviewSurface, mediaPreviewDiagnostics } from "@/lib/media/previewSurface";

/**
 * Banner R2 PREVIEW — musi być widoczny zaraz po hydracji (poza AuthGate),
 * żeby potwierdzić właściwy bundle jeszcze przed / po logowaniu.
 */
export function R2PreviewBanner() {
  const [oauth, setOauth] = useState<OAuthOriginDiag | null>(null);

  useEffect(() => {
    if (!isR2PreviewSurface()) return;
    setOauth(getOAuthOriginDiag());
  }, []);

  if (!isR2PreviewSurface()) return null;
  const d = mediaPreviewDiagnostics();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-3 left-3 z-[10050] max-w-[min(100vw-1.5rem,20rem)] rounded-md border-2 border-amber-400 bg-amber-950 px-2.5 py-1.5 text-[11px] leading-snug text-amber-50 shadow-lg"
      data-r2-preview-banner="1"
      data-build-id={CLIENT_BUILD_VERSION}
      data-build-pipeline={d.buildPipeline}
      data-host={d.host || "n/a"}
    >
      <div className="font-bold tracking-wide text-amber-200">R2 PREVIEW</div>
      <div className="opacity-95">Build: {CLIENT_BUILD_VERSION}</div>
      <div className="opacity-95">Media pipeline: {d.buildPipeline}</div>
      {d.host ? <div className="opacity-80">Host: {d.host}</div> : null}
      {oauth?.beforeHost ? (
        <div className="mt-1 border-t border-amber-400/40 pt-1 opacity-90">
          <div>OAuth before: {oauth.beforeHost}</div>
          <div>OAuth after: {oauth.afterHost ?? "—"}</div>
        </div>
      ) : null}
    </div>
  );
}
