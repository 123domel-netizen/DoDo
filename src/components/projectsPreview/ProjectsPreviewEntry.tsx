import { Suspense, useEffect, useState, type ComponentType } from "react";
import { CalendarRange, ClipboardList } from "lucide-react";
import { useSchedulesAvailable } from "@/hooks/useScheduleRepo";
import { isSchedulesModuleEnabled } from "@/lib/schedules/enabled";

type AppProps = {
  onClose: () => void;
  embedded?: boolean;
  initialSection?: "board" | "attendance";
};

type SchedulesSection = "board" | "attendance";

const lazyApp = () =>
  import("./ProjectsPreviewApp").then((m) => ({
    default: m.ProjectsPreviewApp,
  }));

function sectionChrome(section: SchedulesSection) {
  if (section === "attendance") {
    return {
      label: "Obecności",
      Icon: ClipboardList,
    };
  }
  return {
    label: "Harmonogramy",
    Icon: CalendarRange,
  };
}

/** Entry to Harmonogramy / Obecności — visible when useSchedulesAvailable(). */
export function ProjectsPreviewEntry({
  variant = "toolbar",
  open: openProp,
  onOpenChange,
  section = "board",
}: {
  variant?: "toolbar" | "mobileTab";
  /** Controlled open (mobile shell keeps the bottom nav visible). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  section?: SchedulesSection;
}) {
  const available = useSchedulesAvailable();
  if (!available) return null;
  return (
    <ProjectsPreviewEntryLive
      variant={variant}
      openProp={openProp}
      onOpenChange={onOpenChange}
      section={section}
    />
  );
}

function ProjectsPreviewEntryLive({
  variant,
  openProp,
  onOpenChange,
  section,
}: {
  variant: "toolbar" | "mobileTab";
  openProp?: boolean;
  onOpenChange?: (open: boolean) => void;
  section: SchedulesSection;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const [App, setApp] = useState<ComponentType<AppProps> | null>(null);
  const { label, Icon } = sectionChrome(section);

  const ensureApp = () => {
    setOpen(true);
    if (!App) {
      void lazyApp().then((m) => setApp(() => m.default));
    }
  };

  const close = () => setOpen(false);

  // Mobile tab: shell hosts the panel in <main> — entry only renders the tab button.
  const hostInShell = variant === "mobileTab" && controlled;

  const overlay =
    !hostInShell && open && App ? (
      <Suspense fallback={null}>
        <App onClose={close} initialSection={section} />
      </Suspense>
    ) : !hostInShell && open ? (
      <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-surface text-sm text-ink-faint">
        Ładowanie…
      </div>
    ) : null;

  if (variant === "mobileTab") {
    return (
      <>
        <button
          type="button"
          onClick={() => {
            if (open) close();
            else ensureApp();
          }}
          className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition ${
            open ? "text-accent" : "text-ink-faint"
          }`}
          aria-label={label}
          aria-pressed={open}
        >
          <span className="relative flex h-6 w-6 items-center justify-center">
            <Icon size={22} strokeWidth={open ? 2.25 : 1.75} />
          </span>
          <span className="max-w-full truncate text-[10px] font-medium leading-none">
            {label}
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
        aria-label={label}
        title={label}
      >
        <span className="inline-flex items-center gap-1.5">
          <Icon size={16} />
          {label}
        </span>
      </button>
      {overlay}
    </>
  );
}

/** Lazy panel for MobileShell main area (keeps bottom nav visible). */
export function ProjectsPreviewMobilePanel({
  onClose,
  initialSection = "board",
}: {
  onClose: () => void;
  initialSection?: SchedulesSection;
}) {
  const [App, setApp] = useState<ComponentType<AppProps> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void lazyApp().then((m) => {
      if (!cancelled) setApp(() => m.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!App) {
    return (
      <div className="flex h-full items-center justify-center bg-surface text-sm text-ink-faint">
        Ładowanie…
      </div>
    );
  }
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center bg-surface text-sm text-ink-faint">
          Ładowanie…
        </div>
      }
    >
      <App
        key={initialSection}
        onClose={onClose}
        embedded
        initialSection={initialSection}
      />
    </Suspense>
  );
}

/** For tests / static checks (DEV or preview build without org context). */
export function projectsPreviewMenuVisible(): boolean {
  return isSchedulesModuleEnabled(false);
}
