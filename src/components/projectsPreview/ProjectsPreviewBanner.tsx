/**
 * Fixed badge confirming PROJECTS PREVIEW isolation from production data.
 */
export function ProjectsPreviewBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-3 right-3 z-[10050] max-w-[min(100vw-1.5rem,18rem)] rounded-md border-2 border-amber-400 bg-amber-950 px-2.5 py-1.5 text-[11px] leading-snug text-amber-50 shadow-lg"
      data-projects-preview-banner="1"
    >
      <div className="font-bold tracking-wide text-amber-200">PROJECTS PREVIEW</div>
      <div className="opacity-95">Dane demonstracyjne</div>
      <div className="opacity-90">Brak synchronizacji z produkcją</div>
    </div>
  );
}
