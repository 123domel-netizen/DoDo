import { useState, type ReactNode } from "react";
import { Plus, Trash2, Users, X } from "lucide-react";
import { createPortal } from "react-dom";
import {
  newCrewMember,
  normalizeCrewMembers,
} from "@/lib/projectsPreview/crewMembers";
import type {
  CrewMember,
  PreviewCrew,
  PreviewUser,
} from "@/lib/projectsPreview/types";

/** Soft palette for timeline bars — similar hues sit next to each other. */
export const CREW_COLORS = [
  // blue
  "#6b8ab8",
  "#5a7399",
  // teal / cyan
  "#6aadb8",
  "#5a9eab",
  "#4a8894",
  // green
  "#6aaf90",
  "#5a9e84",
  "#4a8570",
  // yellow / gold
  "#d4b56a",
  "#c4a35a",
  "#a88a48",
  // orange / terracotta
  "#d49a6a",
  "#c48a5c",
  "#a87348",
  // rose / red
  "#d48a8a",
  "#c47a7a",
  "#a86262",
  // purple / lavender
  "#a090c4",
  "#8f7eb8",
  "#7464a0",
  // slate / grey
  "#8a94a4",
  "#7a8494",
];

interface CrewEditorSheetProps {
  /** null = new brygada. */
  crew: PreviewCrew | null;
  /** Zespół org — do wyboru widoczności. */
  users: PreviewUser[];
  /** Aktualny użytkownik — zawsze w liście przy ograniczeniu. */
  currentUserId: string;
  onClose: () => void;
  onSave: (data: Omit<PreviewCrew, "id"> & { id?: string }) => void;
  onDelete?: () => void;
}

/** Add/edit sheet for a brygada. Shared by the board and the Brygady view. */
export function CrewEditorSheet({
  crew,
  users,
  currentUserId,
  onClose,
  onSave,
  onDelete,
}: CrewEditorSheetProps) {
  const [name, setName] = useState(crew?.name ?? "");
  const [headcount, setHeadcount] = useState(
    crew?.headcount != null ? String(crew.headcount) : "",
  );
  const [supervisor, setSupervisor] = useState(crew?.supervisor ?? "");
  const [company, setCompany] = useState(crew?.company ?? "");
  const [phone, setPhone] = useState(crew?.phone ?? "");
  const [color, setColor] = useState(crew?.color ?? CREW_COLORS[0]!);
  const [members, setMembers] = useState<CrewMember[]>(() =>
    normalizeCrewMembers(crew?.members),
  );
  const [restrictVisibility, setRestrictVisibility] = useState(
    () => (crew?.viewerUserIds?.length ?? 0) > 0,
  );
  const [viewerUserIds, setViewerUserIds] = useState<string[]>(() => {
    const existing = crew?.viewerUserIds ?? [];
    if (existing.length > 0) return existing;
    return currentUserId ? [currentUserId] : [];
  });

  const toggleViewer = (id: string) => {
    if (id === currentUserId) return;
    setViewerUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const submit = () => {
    if (!name.trim()) {
      alert("Podaj nazwę brygady.");
      return;
    }
    const parsed =
      headcount.trim() === "" ? null : Number.parseInt(headcount, 10);
    if (headcount.trim() !== "" && (Number.isNaN(parsed) || parsed! < 0)) {
      alert("Ilość osób musi być liczbą ≥ 0.");
      return;
    }
    let viewers: string[] = [];
    if (restrictVisibility) {
      viewers = Array.from(
        new Set(
          [...viewerUserIds, currentUserId].filter((id) => id.trim().length > 0),
        ),
      );
      if (viewers.length === 0) {
        alert("Wybierz przynajmniej jedną osobę z dostępem.");
        return;
      }
    }
    onSave({
      id: crew?.id,
      name: name.trim(),
      color,
      headcount: parsed,
      supervisor: supervisor.trim(),
      company: company.trim(),
      phone: phone.trim(),
      members: normalizeCrewMembers(members),
      viewerUserIds: viewers,
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[9200] flex items-end justify-center bg-black/50 sm:items-center sm:px-4">
      <button
        type="button"
        className="absolute inset-0"
        aria-label="Zamknij"
        onClick={onClose}
      />
      <div className="relative z-10 max-h-[90vh] w-full overflow-y-auto thin-scrollbar rounded-t-2xl border border-line bg-surface-overlay p-4 shadow-pop sm:max-w-md sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Users size={14} className="text-accent" />
            {crew ? "Edycja brygady" : "Nowa brygada"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-ink-faint hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={18} />
          </button>
        </div>
        <div className="space-y-2.5">
          <Field label="Nazwa">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Ilość osób">
              <input
                type="number"
                min={0}
                value={headcount}
                onChange={(e) => setHeadcount(e.target.value)}
                placeholder="np. 4"
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field label="Telefon">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+48 …"
                className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
              />
            </Field>
          </div>
          <Field label="Osoba nadzorująca">
            <input
              value={supervisor}
              onChange={(e) => setSupervisor(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
            />
          </Field>
          <Field label="Nazwa firmy">
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink"
            />
          </Field>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                Osoby w brygadzie
              </p>
              <button
                type="button"
                onClick={() =>
                  setMembers((prev) => [...prev, newCrewMember("")])
                }
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/10"
              >
                <Plus size={12} />
                Dodaj osobę
              </button>
            </div>
            {members.length === 0 ? (
              <p className="text-[12px] text-ink-faint">
                Brak listy — dodaj osoby, by szybciej wypełniać obecność.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {members.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line/70 bg-surface-raised/40 px-2 py-1.5"
                  >
                    <input
                      value={m.name}
                      onChange={(e) =>
                        setMembers((prev) =>
                          prev.map((x) =>
                            x.id === m.id
                              ? { ...x, name: e.target.value.slice(0, 80) }
                              : x,
                          ),
                        )
                      }
                      placeholder="Imię i nazwisko"
                      className="min-w-0 flex-1 rounded border border-line/70 bg-surface-raised px-2 py-1 text-[12px] text-ink"
                      aria-label="Nazwa osoby"
                    />
                    <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-ink-light">
                      <input
                        type="checkbox"
                        checked={m.pinAttendance}
                        onChange={(e) =>
                          setMembers((prev) =>
                            prev.map((x) =>
                              x.id === m.id
                                ? { ...x, pinAttendance: e.target.checked }
                                : x,
                            ),
                          )
                        }
                        className="accent-accent"
                      />
                      Przypnij obecności
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setMembers((prev) => prev.filter((x) => x.id !== m.id))
                      }
                      className="rounded p-1 text-ink-faint hover:bg-red-950/30 hover:text-red-300"
                      aria-label="Usuń osobę"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <fieldset>
            <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
              Widoczność
            </legend>
            <div className="space-y-2 rounded-lg border border-line/70 bg-surface-raised/40 p-2.5">
              <label className="flex cursor-pointer items-start gap-2 text-[12px] text-ink">
                <input
                  type="radio"
                  name="crew-visibility"
                  checked={!restrictVisibility}
                  onChange={() => setRestrictVisibility(false)}
                  className="mt-0.5 accent-accent"
                />
                <span>
                  <span className="font-medium">Cały zespół</span>
                  <span className="mt-0.5 block text-[11px] text-ink-faint">
                    Wszyscy w org widzą brygadę i obecności.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-[12px] text-ink">
                <input
                  type="radio"
                  name="crew-visibility"
                  checked={restrictVisibility}
                  onChange={() => {
                    setRestrictVisibility(true);
                    setViewerUserIds((prev) =>
                      prev.length > 0
                        ? prev
                        : currentUserId
                          ? [currentUserId]
                          : [],
                    );
                  }}
                  className="mt-0.5 accent-accent"
                />
                <span>
                  <span className="font-medium">Wybrane osoby</span>
                  <span className="mt-0.5 block text-[11px] text-ink-faint">
                    Tylko zaznaczeni widzą brygadę i jej obecności.
                  </span>
                </span>
              </label>
              {restrictVisibility ? (
                <div className="max-h-40 space-y-1 overflow-y-auto thin-scrollbar rounded-lg border border-line bg-surface-raised/50 p-2">
                  {users.length === 0 ? (
                    <p className="px-1 py-1 text-[12px] text-ink-faint">
                      Brak listy zespołu.
                    </p>
                  ) : (
                    users.map((u) => {
                      const isSelf = u.id === currentUserId;
                      const checked =
                        isSelf || viewerUserIds.includes(u.id);
                      return (
                        <label
                          key={u.id}
                          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-ink hover:bg-surface-raised"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={isSelf}
                            onChange={() => toggleViewer(u.id)}
                            className="accent-[var(--color-accent,#3b82f6)]"
                          />
                          <span className="min-w-0 truncate">
                            {u.displayName}
                            {isSelf ? (
                              <span className="ml-1 text-[10px] text-ink-faint">
                                (ty)
                              </span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
          </fieldset>

          <Field label="Kolor na osi">
            <div className="flex flex-wrap gap-2">
              {CREW_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full transition ${
                    color === c
                      ? "ring-2 ring-accent ring-offset-2 ring-offset-surface-overlay"
                      : "opacity-80 hover:opacity-100"
                  }`}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="mt-2 h-8 w-full cursor-pointer rounded border border-line bg-transparent"
            />
          </Field>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          {onDelete ? (
            <button
              type="button"
              onClick={() => {
                if (confirm("Usunąć brygadę?")) onDelete();
              }}
              className="rounded-lg px-3 py-2 text-sm text-red-400 hover:bg-red-950/30"
            >
              Usuń
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-sm text-ink-light hover:bg-surface-raised"
            >
              Anuluj
            </button>
            <button
              type="button"
              onClick={submit}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
            >
              Zapisz
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
      </span>
      {children}
    </label>
  );
}
