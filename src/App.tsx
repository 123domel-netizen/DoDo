import { lazy, Suspense, useEffect, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import { CalendarView } from "@/components/calendar/CalendarView";
import { SidePanel } from "@/components/SidePanel";
import { GroupRail } from "@/components/groups/GroupRail";
import { AuthGate } from "@/components/AuthGate";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { MobileShell } from "@/components/mobile/MobileShell";
import { GroupSelectPrompt } from "@/components/prompts/GroupSelectPrompt";
import { useStore } from "@/state/store";
import { useReminderScheduler } from "@/hooks/useReminderScheduler";
import { useAutoCloudRefresh } from "@/hooks/useAutoCloudRefresh";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useHubHotkeys } from "@/hooks/useHubHotkeys";
import { cloudEnabled } from "@/lib/supabase";
import { useChatStore } from "@/lib/chat/store";
import { closeChatDetailPanel } from "@/lib/chat/init";
import { watchSystemTheme, applyTheme } from "@/lib/theme";
import { installNotifyAudioArm } from "@/lib/chat/notifySound";

const WorkspaceHub = lazy(() =>
  import("@/components/hub/WorkspaceHub").then((m) => ({ default: m.WorkspaceHub })),
);

export default function App() {
  const hydrated = useStore((s) => s.hydrated);
  const theme = useStore((s) => s.settings.theme);
  const editingId = useStore((s) => s.editingId);
  const panelMode = useChatStore((s) => s.panelMode);
  const hubExpanded = useChatStore((s) => s.hubExpanded);
  const hubCollapsed = useChatStore((s) => s.hubCollapsed);
  const isMobile = useIsMobile();
  const [todoOpen, setTodoOpen] = useState(true);
  useReminderScheduler();
  useAutoCloudRefresh();
  useHubHotkeys(!isMobile && cloudEnabled);

  useEffect(() => {
    document.title = "DoDo";
  }, []);

  useEffect(() => installNotifyAudioArm(), []);

  useEffect(() => {
    applyTheme(theme);
    watchSystemTheme(theme, () => {});
  }, [theme]);

  // Detal hubu / edytor wymuszają otwarcie prawego panelu.
  const detailForced = Boolean(editingId) || panelMode !== "todo";
  const panelOpen = todoOpen || detailForced;

  useEffect(() => {
    if (detailForced) setTodoOpen(true);
  }, [detailForced]);

  const togglePanel = () => {
    if (detailForced) {
      if (editingId) useStore.getState().setEditing(null);
      if (panelMode !== "todo") closeChatDetailPanel();
      setTodoOpen(false);
      return;
    }
    setTodoOpen((v) => !v);
  };

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-faint">
        Ładowanie…
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <AuthGate>
        <GroupSelectPrompt />
      {isMobile ? (
        <MobileShell />
      ) : (
        <div className="flex h-full flex-col">
          <Toolbar todoOpen={panelOpen} onToggleTodo={togglePanel} />
          <div className="flex min-h-0 flex-1">
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-hidden">
                <CalendarView />
              </div>
              {cloudEnabled && (
                <div
                  className={`min-h-0 shrink-0 overflow-hidden border-t border-line bg-surface ${
                    hubCollapsed
                      ? "h-9"
                      : hubExpanded
                        ? "h-[min(55vh,560px)]"
                        : "h-[min(36vh,340px)]"
                  }`}
                >
                  <ErrorBoundary label="hub" compact>
                    <Suspense
                      fallback={
                        <div className="flex h-full items-center justify-center text-xs text-ink-faint">
                          Ładowanie hubu…
                        </div>
                      }
                    >
                      <div className="h-full min-h-0">
                        <WorkspaceHub />
                      </div>
                    </Suspense>
                  </ErrorBoundary>
                </div>
              )}
            </main>
            {panelOpen && (
              <aside className="relative w-full max-w-[400px] shrink-0 border-l border-accent/20 bg-gradient-to-b from-sidebar/70 to-surface shadow-[-4px_0_20px_rgba(80,60,140,0.08)] md:w-[380px] lg:w-[400px]">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-accent/35 via-accent/10 to-transparent" />
                <SidePanel />
              </aside>
            )}
            <GroupRail />
          </div>
        </div>
      )}
      </AuthGate>
    </ErrorBoundary>
  );
}
