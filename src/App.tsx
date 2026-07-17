import { useEffect, useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import { CalendarView } from "@/components/calendar/CalendarView";
import { SidePanel } from "@/components/SidePanel";
import { GroupRail } from "@/components/groups/GroupRail";
import { AuthGate } from "@/components/AuthGate";
import { MobileShell } from "@/components/mobile/MobileShell";
import { GroupSelectPrompt } from "@/components/prompts/GroupSelectPrompt";
import { useStore } from "@/state/store";
import { useReminderScheduler } from "@/hooks/useReminderScheduler";
import { useAutoCloudRefresh } from "@/hooks/useAutoCloudRefresh";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useChatStore } from "@/lib/chat/store";

export default function App() {
  const hydrated = useStore((s) => s.hydrated);
  const editingId = useStore((s) => s.editingId);
  const isMobile = useIsMobile();
  const [todoOpen, setTodoOpen] = useState(true);
  const chatPanelMode = useChatStore((s) => s.panelMode);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  useReminderScheduler();
  useAutoCloudRefresh();

  useEffect(() => {
    document.title = "DoDo";
  }, []);

  // The editor lives in the side panel, so opening an item forces the panel open.
  // Deep-link do rozmowy (push) też wymusza otwarcie panelu (tryb czatu).
  const panelOpen =
    todoOpen ||
    Boolean(editingId) ||
    (chatPanelMode === "chat" && Boolean(activeConversationId));

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-faint">
        Ładowanie…
      </div>
    );
  }

  return (
    <AuthGate>
      <GroupSelectPrompt />
      {isMobile ? (
        <MobileShell />
      ) : (
        <div className="flex h-full flex-col">
          <Toolbar todoOpen={todoOpen} onToggleTodo={() => setTodoOpen((v) => !v)} />
          <div className="flex min-h-0 flex-1">
            <main className="min-w-0 flex-1">
              <CalendarView />
            </main>
            {panelOpen && (
              <aside className="relative w-full max-w-[400px] shrink-0 border-l border-accent/15 bg-gradient-to-b from-surface-raised/80 to-surface shadow-[-6px_0_24px_rgba(0,0,0,0.12)] md:w-[380px] lg:w-[400px]">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-accent/35 via-accent/10 to-transparent" />
                <SidePanel />
              </aside>
            )}
            <GroupRail />
          </div>
        </div>
      )}
    </AuthGate>
  );
}
