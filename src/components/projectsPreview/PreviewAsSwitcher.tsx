import { UserRound } from "lucide-react";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";

export function PreviewAsSwitcher() {
  const repo = useProjectsPreviewRepo();
  const state = repo.getState();

  return (
    <label className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-faint">
      <UserRound size={13} className="shrink-0 text-accent" />
      <span className="hidden sm:inline">Podgląd jako</span>
      <select
        value={state.viewAsUserId}
        onChange={(e) => repo.setViewAs(e.target.value)}
        className="max-w-[9.5rem] truncate rounded-md border border-line bg-surface-raised px-1.5 py-1 text-[11px] font-medium text-ink outline-none focus:border-line-strong sm:max-w-[12rem]"
        aria-label="Podgląd jako użytkownik"
      >
        {state.users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.displayName}
          </option>
        ))}
      </select>
    </label>
  );
}
