import { type ReactNode } from "react";
import { CalendarClock, ListChecks, Sun } from "lucide-react";
import { showTodoInPanel } from "@/lib/chat/init";

/** Pasek nawigacji nad detalem w prawym panelu (desktop): Zadania / Wydarzenia / Dashboard. */
export function DetailPanelChrome({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line/80 bg-surface-raised/40 px-3 py-2">
        <div className="flex min-w-0 items-stretch gap-1 rounded-xl border border-line bg-surface-raised p-1">
          <ChromeTab
            icon={<ListChecks size={16} />}
            label="Zadania"
            onClick={() => showTodoInPanel("tasks")}
          />
          <ChromeTab
            icon={<CalendarClock size={16} />}
            label="Wydarzenia"
            onClick={() => showTodoInPanel("events")}
          />
          <ChromeTab
            icon={<Sun size={16} />}
            label="Dashboard"
            onClick={() => showTodoInPanel("today")}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function ChromeTab({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-ink-light transition hover:bg-surface-overlay hover:text-ink"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
