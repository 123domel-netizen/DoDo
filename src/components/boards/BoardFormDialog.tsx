import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { BoardFieldsEditor } from "@/components/boards/BoardFieldsEditor";
import { PersonAvatar } from "@/components/chat/PersonAvatar";
import { fetchOrgContacts } from "@/lib/contacts";
import { defaultBoardName } from "@/lib/boards/sections";
import { navigateToBoards } from "@/lib/boards/runtime";
import { useBoardsStore } from "@/lib/boards/store";
import { BOARD_NAME_MAX, type Board } from "@/lib/boards/types";

interface Person {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

function usePeople(open: boolean, orgId: string | null, myUserId: string | null): {
  people: Person[];
  loading: boolean;
} {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !orgId) return;
    let cancelled = false;
    setLoading(true);
    void fetchOrgContacts(orgId).then((contacts) => {
      if (cancelled) return;
      setPeople(
        contacts
          .filter((c) => c.userId !== myUserId && !c.muted)
          .map((c) => ({
            userId: c.userId,
            displayName: (c.displayName || c.email || c.userId).trim(),
            avatarUrl: c.avatarUrl,
          }))
          .sort((a, b) => a.displayName.localeCompare(b.displayName, "pl")),
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, orgId, myUserId]);
  return { people, loading };
}

function PersonPicker({
  people,
  loading,
  selected,
  onToggle,
  emptyLabel,
}: {
  people: Person[];
  loading: boolean;
  selected: Set<string>;
  onToggle: (userId: string) => void;
  emptyLabel: string;
}) {
  if (loading) return <div className="px-1 py-2 text-xs text-ink-faint">Ładowanie osób…</div>;
  if (people.length === 0) {
    return <div className="px-1 py-2 text-xs text-ink-faint">{emptyLabel}</div>;
  }
  return (
    <div className="max-h-48 space-y-0.5 overflow-y-auto thin-scrollbar rounded-lg border border-line bg-surface-raised p-1">
      {people.map((p) => (
        <label
          key={p.userId}
          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink transition hover:bg-surface-overlay"
        >
          <input
            type="checkbox"
            checked={selected.has(p.userId)}
            onChange={() => onToggle(p.userId)}
            className="accent-accent"
          />
          <PersonAvatar userId={p.userId} avatarUrl={p.avatarUrl} size={22} />
          <span className="min-w-0 flex-1 truncate">{p.displayName}</span>
        </label>
      ))}
    </div>
  );
}

function toggleIn(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Nowa tablica: nazwa (opcjonalna — domyślnie z imion) + uczestnicy z organizacji. */
export function CreateBoardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const orgId = useBoardsStore((s) => s.orgId);
  const myUserId = useBoardsStore((s) => s.userId);
  const createBoard = useBoardsStore((s) => s.createBoard);
  const { people, loading } = usePeople(open, orgId, myUserId);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setSelected(new Set());
      setError(null);
    }
  }, [open]);

  const suggestion = useMemo(
    () =>
      defaultBoardName(people.filter((p) => selected.has(p.userId)).map((p) => p.displayName)),
    [people, selected],
  );

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const finalName = name.trim() || suggestion;
    const res = await createBoard({ name: finalName, memberIds: [...selected] });
    setBusy(false);
    if (res.error || !res.id) {
      setError(res.error ?? "Nie udało się utworzyć tablicy.");
      return;
    }
    onClose();
    navigateToBoards({ boardId: res.id }, "push");
  };

  return (
    <Modal open={open} onClose={onClose} width={420} label="Nowa tablica">
      <form
        className="p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="mb-3 text-sm font-semibold text-ink">Nowa tablica</div>
        <label className="mb-1 block text-[11px] font-medium text-ink-faint">Nazwa</label>
        <input
          value={name}
          maxLength={BOARD_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder={selected.size > 0 ? suggestion : "np. Jacek + Dominik"}
          className="mb-3 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition focus:border-accent"
        />
        <label className="mb-1 block text-[11px] font-medium text-ink-faint">
          Uczestnicy (ty jesteś właścicielem)
        </label>
        <PersonPicker
          people={people}
          loading={loading}
          selected={selected}
          onToggle={(id) => setSelected((s) => toggleIn(s, id))}
          emptyLabel="Brak innych osób w organizacji — tablica będzie tylko Twoja."
        />
        {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-light transition hover:bg-surface-raised hover:text-ink"
          >
            Anuluj
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? "Tworzenie…" : "Utwórz"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Ustawienia tablicy: nazwa, uczestnicy, opuszczenie / archiwizacja. */
export function ManageBoardDialog({
  board,
  open,
  onClose,
}: {
  board: Board;
  open: boolean;
  onClose: () => void;
}) {
  const myUserId = useBoardsStore((s) => s.userId);
  const orgId = useBoardsStore((s) => s.orgId);
  const renameBoard = useBoardsStore((s) => s.renameBoard);
  const addMembers = useBoardsStore((s) => s.addMembers);
  const removeMember = useBoardsStore((s) => s.removeMember);
  const archiveBoard = useBoardsStore((s) => s.archiveBoard);
  const isOwner = board.myRole === "owner";
  const { people, loading } = usePeople(open && isOwner, orgId, myUserId);
  const memberIds = useMemo(() => new Set(board.members.map((m) => m.userId)), [board.members]);
  const candidates = useMemo(() => people.filter((p) => !memberIds.has(p.userId)), [people, memberIds]);
  const [name, setName] = useState(board.name);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(board.name);
      setSelected(new Set());
      setError(null);
    }
  }, [open, board.name]);

  const run = async (fn: () => Promise<{ error?: string }>, closeAfter = false) => {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (res.error) setError(res.error);
    else if (closeAfter) onClose();
    return res;
  };

  const saveName = async () => {
    const clean = name.trim();
    if (!clean || clean === board.name) return;
    await run(() => renameBoard(board.id, clean));
  };

  return (
    <Modal open={open} onClose={onClose} width={440} label="Ustawienia tablicy">
      <div className="p-4">
        <div className="mb-3 text-sm font-semibold text-ink">Ustawienia tablicy</div>

        {isOwner && (
          <>
            <label className="mb-1 block text-[11px] font-medium text-ink-faint">Nazwa</label>
            <input
              value={name}
              maxLength={BOARD_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveName();
                }
              }}
              className="mb-3 w-full rounded-lg border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition focus:border-accent"
            />
          </>
        )}

        <div className="mb-1 text-[11px] font-medium text-ink-faint">
          Uczestnicy ({board.members.length})
        </div>
        <ul className="mb-3 space-y-0.5">
          {board.members.map((m) => {
            const self = m.userId === myUserId;
            const canRemove = (isOwner || self) && !(m.role === "owner" && board.members.filter((x) => x.role === "owner").length === 1);
            return (
              <li key={m.userId} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-ink">
                <PersonAvatar userId={m.userId} avatarUrl={m.avatarUrl} size={22} />
                <span className="min-w-0 flex-1 truncate">
                  {m.displayName || "Użytkownik"}
                  {self ? " (Ty)" : ""}
                </span>
                {m.role === "owner" && (
                  <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
                    właściciel
                  </span>
                )}
                {canRemove && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const msg = self
                        ? "Opuścić tę tablicę? Stracisz do niej dostęp."
                        : `Usunąć ${m.displayName || "użytkownika"} z tablicy?`;
                      if (!window.confirm(msg)) return;
                      void run(() => removeMember(board.id, m.userId), self);
                    }}
                    className="rounded px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:bg-surface-raised hover:text-red-400"
                  >
                    {self ? "Opuść" : "Usuń"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {isOwner && (
          <>
            <div className="mb-1 text-[11px] font-medium text-ink-faint">Dodaj osoby</div>
            <PersonPicker
              people={candidates}
              loading={loading}
              selected={selected}
              onToggle={(id) => setSelected((s) => toggleIn(s, id))}
              emptyLabel="Wszyscy z organizacji są już na tej tablicy."
            />
            {selected.size > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const res = await addMembers(board.id, [...selected]);
                    if (!res.error) setSelected(new Set());
                    return res;
                  })
                }
                className="mt-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
              >
                Dodaj ({selected.size})
              </button>
            )}

            <div className="my-3 border-t border-line/60" />
            <BoardFieldsEditor board={board} />
          </>
        )}

        {error && <div className="mt-2 text-xs text-red-400">{error}</div>}

        <div className="mt-4 flex items-center justify-between gap-2">
          {isOwner ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    "Zarchiwizować tablicę? Zniknie z listy; tematy i komentarze zostaną zachowane.",
                  )
                ) {
                  return;
                }
                void run(() => archiveBoard(board.id), true);
              }}
              className="rounded-lg px-3 py-1.5 text-sm text-red-400 transition hover:bg-red-500/10"
            >
              Archiwizuj tablicę
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-sm text-ink-light transition hover:bg-surface-raised hover:text-ink"
          >
            Gotowe
          </button>
        </div>
      </div>
    </Modal>
  );
}
