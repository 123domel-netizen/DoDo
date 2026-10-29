import { useState } from "react";
import { Plus, Settings2 } from "lucide-react";
import { navigateToBoards } from "@/lib/boards/runtime";
import { useBoardsStore } from "@/lib/boards/store";
import { CreateBoardDialog, ManageBoardDialog } from "@/components/boards/BoardFormDialog";

/** Rząd z nazwami tablic (w miejscu Dzień/Tydzień/… kalendarza) + nowa tablica + ustawienia. */
export function BoardChips({ compact = false }: { compact?: boolean }) {
  const boards = useBoardsStore((s) => s.boards);
  const activeBoardId = useBoardsStore((s) => s.activeBoardId);
  const [creating, setCreating] = useState(false);
  const [managing, setManaging] = useState(false);
  const active = boards.find((b) => b.id === activeBoardId) ?? null;

  const chip = (isActive: boolean) =>
    `relative flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs transition ${
      isActive ? "bg-accent text-white shadow-glow" : "text-ink-light hover:text-ink"
    }`;

  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${compact ? "px-2 py-1.5" : ""}`}>
      <div
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto thin-scrollbar rounded-md border border-line bg-surface-raised p-0.5"
        role="tablist"
        aria-label="Tablice"
      >
        {boards.length === 0 && (
          <span className="px-2 py-0.5 text-xs text-ink-faint">Brak tablic</span>
        )}
        {boards.map((b) => {
          const isActive = b.id === activeBoardId;
          return (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => navigateToBoards({ boardId: b.id })}
              className={chip(isActive)}
              title={b.name}
            >
              <span className="max-w-[160px] truncate">{b.name}</span>
              {b.unreadCount > 0 && (
                <span
                  className={`flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none ${
                    isActive ? "bg-white/25 text-white" : "bg-accent text-white"
                  }`}
                  aria-label={`${b.unreadCount} nieprzeczytanych`}
                >
                  {b.unreadCount > 99 ? "99+" : b.unreadCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setCreating(true)}
        className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-surface-raised px-2 py-1 text-xs text-ink transition hover:border-line-strong"
        aria-label="Nowa tablica"
        title="Nowa tablica"
      >
        <Plus size={13} />
        {!compact && <span>Tablica</span>}
      </button>
      {active && (
        <button
          type="button"
          onClick={() => setManaging(true)}
          className="shrink-0 rounded-md p-1 text-ink-light transition hover:bg-surface-overlay hover:text-ink"
          aria-label="Ustawienia tablicy"
          title="Ustawienia tablicy"
        >
          <Settings2 size={15} />
        </button>
      )}
      <CreateBoardDialog open={creating} onClose={() => setCreating(false)} />
      {active && (
        <ManageBoardDialog board={active} open={managing} onClose={() => setManaging(false)} />
      )}
    </div>
  );
}
