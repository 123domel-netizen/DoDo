import { useMemo, useState } from "react";
import { AlertTriangle, Pencil, Plus, Users } from "lucide-react";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import type { PreviewCrew } from "@/lib/projectsPreview/types";
import { CrewEditorSheet } from "./CrewEditorSheet";

interface CrewsViewProps {
  /** Opened from the header „+ Brygada”. */
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}

const COLUMN_COUNT = 7;

/** Brygady: kto pracuje, na ilu robotach i gdzie się zderza z samą sobą. */
export function CrewsView({ createOpen, onCreateOpenChange }: CrewsViewProps) {
  const repo = useProjectsPreviewRepo();
  const state = repo.getState();
  const [editing, setEditing] = useState<PreviewCrew | null>(null);

  const conflictsByCrew = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of repo.crewConflicts()) {
      m.set(c.crewId, (m.get(c.crewId) ?? 0) + 1);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- conflicts derive from blocks
  }, [repo, state.scheduleBlocks, state.projects, state.viewAsUserId]);

  const closeSheet = () => {
    setEditing(null);
    onCreateOpenChange(false);
  };

  const sheetOpen = createOpen || editing != null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto thin-scrollbar">
        <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
          <thead className="sticky top-0 z-10 bg-surface-raised/95 backdrop-blur-sm">
            <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              <th className="min-w-[10rem] px-2 py-1">Brygada</th>
              <th className="w-[4rem] px-1.5 py-1">Osób</th>
              <th className="min-w-[8rem] px-1.5 py-1">Firma</th>
              <th className="min-w-[8rem] px-1.5 py-1">Nadzorujący</th>
              <th className="w-[7rem] px-1.5 py-1">Telefon</th>
              <th className="w-[4.5rem] px-1.5 py-1">Roboty</th>
              <th className="w-[5.5rem] px-1.5 py-1">Konflikty</th>
            </tr>
          </thead>
          <tbody>
            {state.crews.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMN_COUNT}
                  className="px-4 py-8 text-center text-sm text-ink-faint"
                >
                  <div className="flex flex-col items-center gap-2">
                    <Users size={20} className="text-ink-faint" />
                    Brak brygad — dodaj pierwszą, aby przypisywać roboty.
                    <button
                      type="button"
                      onClick={() => onCreateOpenChange(true)}
                      className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
                    >
                      <Plus size={12} />
                      Dodaj brygadę
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              state.crews.map((crew) => {
                const works = repo.crewWorkCount(crew.id);
                const conflicts = conflictsByCrew.get(crew.id) ?? 0;
                return (
                  <tr
                    key={crew.id}
                    className="cursor-pointer border-b border-line/50 transition hover:bg-surface-raised/50"
                    onClick={() => setEditing(crew)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setEditing(crew);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                  >
                    <td className="px-2 py-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: crew.color }}
                          aria-hidden
                        />
                        <span className="min-w-0 truncate font-medium text-ink">
                          {crew.name}
                        </span>
                        <Pencil
                          size={11}
                          className="shrink-0 text-ink-faint"
                          aria-hidden
                        />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-1 tabular-nums text-ink-light">
                      {crew.headcount ?? "—"}
                    </td>
                    <td className="max-w-[12rem] truncate px-1.5 py-1 text-ink-light">
                      {crew.company || "—"}
                    </td>
                    <td className="max-w-[12rem] truncate px-1.5 py-1 text-ink-light">
                      {crew.supervisor || "—"}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-1 text-ink-light">
                      {crew.phone || "—"}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-1 tabular-nums text-ink-light">
                      {works}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-1">
                      {conflicts > 0 ? (
                        <span
                          className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1 py-px text-[11px] font-semibold tabular-nums text-amber-300"
                          title="Ta brygada jest w dwóch miejscach jednocześnie"
                        >
                          <AlertTriangle size={11} />
                          {conflicts}
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {sheetOpen ? (
        <CrewEditorSheet
          key={editing?.id ?? "new-crew"}
          crew={editing}
          onClose={closeSheet}
          onSave={(data) => {
            repo.upsertCrew(data);
            closeSheet();
          }}
          onDelete={
            editing
              ? () => {
                  const res = repo.deleteCrew(editing.id);
                  if (!res.ok) {
                    alert(res.error);
                    return;
                  }
                  closeSheet();
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
