import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useProjectsPreviewRepo } from "@/hooks/useProjectsPreviewRepo";
import {
  scheduleCreateProject,
  scheduleUpdateProject,
} from "@/lib/schedules/scheduleRepoActions";
import { todayIso } from "@/lib/projectsPreview/projectMetrics";
import {
  countPresetItems,
  defaultPlannedEndDate,
} from "@/lib/projectsPreview/schedulePresetSeed";
import type { PreviewProject } from "@/lib/projectsPreview/types";
import { IsoDateInput } from "./IsoDateInput";

interface ProjectFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** When set, edit mode (admin only in repo). */
  project?: PreviewProject | null;
  onSaved?: (projectId: string) => void;
}

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
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [applyPreset, setApplyPreset] = useState(true);
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(defaultPlannedEndDate(todayIso()));
  /** Gdy użytkownik ręcznie zmieni koniec — nie nadpisuj przy zmianie startu. */
  const [endTouched, setEndTouched] = useState(false);

  const presetCounts = useMemo(
    () => countPresetItems(state.scheduleCatalog),
    [state.scheduleCatalog],
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (project) {
      setNumber(String(project.number));
      setName(project.name);
      setMemberIds(project.memberIds.filter((id) => id !== project.adminUserId));
    } else {
      const start = todayIso();
      setNumber(String(repo.suggestNextNumber()));
      setName("");
      setMemberIds([]);
      setApplyPreset(true);
      setStartDate(start);
      setEndDate(defaultPlannedEndDate(start));
      setEndTouched(false);
    }
  }, [open, project, repo]);

  const onStartChange = (value: string) => {
    setStartDate(value);
    if (!endTouched && value) {
      setEndDate(defaultPlannedEndDate(value));
    }
  };

  const toggleMember = (id: string) => {
    setMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const submit = async () => {
    setError(null);
    setSaving(true);
    const code = number.trim();
    if (!code) {
      setError("Podaj numer lub ID budowy.");
      setSaving(false);
      return;
    }
    if (!name.trim()) {
      setError("Nazwa jest wymagana.");
      setSaving(false);
      return;
    }
    if (editing && project) {
      if (repo.numberExists(code, project.id)) {
        setError("Numer już istnieje w zespole.");
        setSaving(false);
        return;
      }
      const res = await scheduleUpdateProject(repo, project.id, {
        number: code,
        name: name.trim(),
        memberIds,
      });
      setSaving(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved?.(project.id);
      onClose();
      return;
    }
    if (repo.numberExists(code)) {
      setError("Numer już istnieje w zespole.");
      setSaving(false);
      return;
    }
    if (applyPreset) {
      if (!startDate) {
        setError("Podaj dzień początku budowy.");
        setSaving(false);
        return;
      }
      if (!endDate) {
        setError("Podaj planowaną datę zakończenia.");
        setSaving(false);
        return;
      }
      if (endDate < startDate) {
        setError("Data zakończenia nie może być wcześniejsza niż początek.");
        setSaving(false);
        return;
      }
    }
    const res = await scheduleCreateProject(repo, {
      number: code,
      name: name.trim(),
      memberIds,
      schedulePreset: applyPreset
        ? { startDate, endDate }
        : null,
    });
    setSaving(false);
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
          Każdy projekt to budowa. Administrator ustawiany jest automatycznie,
          numer / ID musi być unikalny w zespole.
        </p>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Numer / ID
            </span>
            <input
              type="text"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="np. 131 lub B-2026/01"
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Nazwa
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='np. "Charzykowy - Słoneczna Ostoja"'
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none focus:border-line-strong"
            />
          </label>

          {!editing ? (
            <div className="rounded-lg border border-line bg-surface-raised/40 p-3">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={applyPreset}
                  onChange={(e) => setApplyPreset(e.target.checked)}
                  className="mt-0.5 accent-[var(--color-accent,#3b82f6)]"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">
                    Wypełnij harmonogram z katalogu
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-ink-faint">
                    {presetCounts.categories} kategorii i{" "}
                    {presetCounts.subcategories} podkategorii, bez zakresów —
                    rozłożone na planowany okres budowy.
                  </span>
                </span>
              </label>

              {applyPreset ? (
                <div className="mt-3 grid grid-cols-2 gap-2.5">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Początek budowy
                    </span>
                    <IsoDateInput
                      value={startDate}
                      onChange={onStartChange}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Planowane zakończenie
                    </span>
                    <IsoDateInput
                      value={endDate}
                      onChange={(iso) => {
                        setEndTouched(true);
                        setEndDate(iso);
                      }}
                    />
                  </label>
                  <p className="col-span-2 text-[11px] text-ink-faint">
                    Domyślnie ~12 miesięcy. Etapy mają różne wagi (np. stan surowy
                    dłużej niż pod klucz).
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <fieldset>
            <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Uczestnicy
            </legend>
            <div className="max-h-40 space-y-1 overflow-y-auto thin-scrollbar rounded-lg border border-line bg-surface-raised/50 p-2">
              {state.users.map((u) => {
                  const isAdmin =
                  editing && project
                    ? u.id === project.adminUserId
                    : u.id === repo.currentUserId();
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
            disabled={saving}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
          >
            {saving ? "Zapis…" : editing ? "Zapisz" : "Dodaj projekt"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
