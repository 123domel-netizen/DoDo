import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import {
  PROJECT_KIND_LABEL,
  type PreviewProject,
  type ProjectKind,
} from "@/lib/projectsPreview/types";

interface ProjectFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** When set, edit mode (admin only in repo). */
  project?: PreviewProject | null;
  onSaved?: (projectId: string) => void;
}

const KINDS = Object.keys(PROJECT_KIND_LABEL) as ProjectKind[];

export function ProjectFormDialog({
  open,
  onClose,
  project,
  onSaved,
}: ProjectFormDialogProps) {
  const repo = useProjectsPreviewRepo();
  const state = repo.getState();
  const editing = Boolean(project);

  const [number, setNumber] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ProjectKind>("nadzor");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (project) {
      setNumber(String(project.number));
      setName(project.name);
      setKind(project.kind);
      setMemberIds(project.memberIds.filter((id) => id !== project.adminUserId));
    } else {
      setNumber(String(repo.suggestNextNumber()));
      setName("");
      setKind("nadzor");
      setMemberIds([]);
    }
  }, [open, project, repo]);

  const toggleMember = (id: string) => {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const submit = () => {
    setError(null);
    const num = Number(number);
    if (!Number.isInteger(num) || num <= 0) {
      setError("Podaj prawidłowy numer projektu.");
      return;
    }
    if (!name.trim()) {
      setError("Nazwa jest wymagana.");
      return;
    }
    if (editing && project) {
      if (repo.numberExists(num, project.id)) {
        setError("Numer już istnieje w zespole.");
        return;
      }
      // Number is immutable after create in model — only name/kind/members/status
      const res = repo.updateProject(project.id, {
        name: name.trim(),
        kind,
        memberIds,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved?.(project.id);
      onClose();
      return;
    }
    if (repo.numberExists(num)) {
      setError("Numer już istnieje w zespole.");
      return;
    }
    const res = repo.createProject({
      number: num,
      name: name.trim(),
      kind,
      memberIds,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved?.(res.project.id);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} width={480}>
      <div className="p-5">
        <h2 className="mb-1 text-lg font-semibold text-ink">
          {editing ? "Edytuj projekt" : "Nowy projekt"}
        </h2>
        <p className="mb-4 text-sm text-ink-faint">
          Administrator ustawiany jest automatycznie. Numer musi być unikalny w zespole.
        </p>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Numer
            </span>
            <input
              type="number"
              min={1}
              value={number}
              disabled={editing}
              onChange={(e) => setNumber(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none focus:border-line-strong disabled:opacity-60"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Nazwa
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Vestino - Więcbork"
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Rodzaj
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ProjectKind)}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {PROJECT_KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <fieldset>
            <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Uczestnicy
            </legend>
            <div className="max-h-40 space-y-1 overflow-y-auto thin-scrollbar rounded-lg border border-line bg-surface-raised/50 p-2">
              {state.users.map((u) => {
                const isAdmin =
                  editing && project
                    ? u.id === project.adminUserId
                    : u.id === state.viewAsUserId;
                const checked = isAdmin || memberIds.includes(u.id);
                return (
                  <label
                    key={u.id}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-ink hover:bg-surface-raised"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isAdmin}
                      onChange={() => toggleMember(u.id)}
                      className="accent-[var(--color-accent,#3b82f6)]"
                    />
                    <span className="min-w-0 truncate">
                      {u.displayName}
                      {isAdmin ? (
                        <span className="ml-1 text-[10px] text-ink-faint">
                          (admin)
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-light transition hover:text-ink"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            {editing ? "Zapisz" : "Dodaj projekt"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
