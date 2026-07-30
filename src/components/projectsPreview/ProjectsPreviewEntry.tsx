import { Suspense, useState, type ComponentType } from "react";
import { CalendarRange } from "lucide-react";
import { useSchedulesAvailable } from "@/hooks/useScheduleRepo";
import { isSchedulesModuleEnabled } from "@/lib/schedules/enabled";

type AppProps = { onClose: () => void; embedded?: boolean };

const lazyApp = () =>
  import("./ProjectsPreviewApp").then((m) => ({
    default: m.ProjectsPreviewApp,
  }));

/** Entry to Harmonogramy — visible when useSchedulesAvailable(). */
export function ProjectsPreviewEntry({
  variant = "toolbar",
}: {
  variant?: "toolbar" | "mobileTab";
}) {
  const available = useSchedulesAvailable();
  if (!available) return null;
  return <ProjectsPreviewEntryLive variant={variant} />;
}

function ProjectsPreviewEntryLive({
  variant,
}: {
  variant: "toolbar" | "mobileTab";
}) {
  const [open, setOpen] = useState(false);
  const [App, setApp] = useState<ComponentType<AppProps> | null>(null);

  const ensureApp = () => {
    setOpen(true);
    if (!App) {
      void lazyApp().then((m) => setApp(() => m.default));
    }
  };

  const overlay =
    open && App ? (
      <Suspense fallback={null}>
        <App onClose={() => setOpen(false)} />
      </Suspense>
    ) : open ? (
      <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-surface text-sm text-ink-faint">
        Ładowanie harmonogramów…
      </div>
    ) : null;

  if (variant === "mobileTab") {
    return (
      <>
        <button
          type="button"
          onClick={ensureApp}
          className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition ${
            open ? "text-accent" : "text-ink-faint"
          }`}
          aria-label="Harmonogramy"
          aria-pressed={open}
        >
          <span className="relative flex h-6 w-6 items-center justify-center">
            <CalendarRange size={22} strokeWidth={open ? 2.25 : 1.75} />
          </span>
          <span className="max-w-full truncate text-[10px] font-medium leading-none">
            Harmonogramy
          </span>
        </button>
        {overlay}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={ensureApp}
        className="rounded-lg px-2 py-1.5 text-xs font-medium text-ink-light transition hover:bg-surface-overlay hover:text-ink"
        aria-label="Harmonogramy"
        title="Harmonogramy"
      >
        <span className="inline-flex items-center gap-1.5">
          <CalendarRange size={16} />
          Harmonogramy
        </span>
      </button>
      {overlay}
    </>
  );
}

/** For tests / static checks (DEV or preview build without org context). */
export function projectsPreviewMenuVisible(): boolean {
  return isSchedulesModuleEnabled(false);
}
