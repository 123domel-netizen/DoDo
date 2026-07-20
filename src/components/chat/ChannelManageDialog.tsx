import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Camera, Shield, ShieldOff, Upload, UserMinus, UserPlus } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ChannelIcon } from "@/components/chat/ChannelIcon";
import { PersonAvatar } from "@/components/chat/PersonAvatar";
import { useChatStore } from "@/lib/chat/store";
import { useStore } from "@/state/store";
import { loadChatEligiblePeople } from "@/lib/contacts";
import {
  CHANNEL_ICON_PRESETS,
  parseChannelPresetId,
} from "@/lib/chat/channelPresets";
import {
  archiveConversation,
  inviteMember,
  removeMember,
  setChannelIcon,
  setChannelIconPreset,
  setChannelMemberRole,
} from "@/lib/chat/init";
import type { ChatOverviewEntry } from "@/lib/chat/types";

interface ChannelManageDialogProps {
  open: boolean;
  onClose: () => void;
  entry: ChatOverviewEntry;
}

function isAdminRole(role: string): boolean {
  return role === "owner" || role === "admin";
}

type Person = { userId: string; displayName: string; avatarUrl: string | null };

export function ChannelManageDialog({ open, onClose, entry }: ChannelManageDialogProps) {
  const myUserId = useChatStore((s) => s.userId);
  const myOrgs = useStore((s) => s.myOrgs);
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [iconPicker, setIconPicker] = useState(false);
  const [pickIds, setPickIds] = useState<Set<string>>(new Set());
  const [eligible, setEligible] = useState<Person[]>([]);

  const members = useMemo(
    () =>
      [...entry.members].sort((a, b) => {
        const ar = isAdminRole(a.role) ? 0 : 1;
        const br = isAdminRole(b.role) ? 0 : 1;
        if (ar !== br) return ar - br;
        return a.displayName.localeCompare(b.displayName, "pl");
      }),
    [entry.members],
  );

  const adminCount = members.filter((m) => isAdminRole(m.role)).length;
  const activePresetId = parseChannelPresetId(entry.iconUrl);

  useEffect(() => {
    if (!open) {
      setIconPicker(false);
      return;
    }
    let cancelled = false;
    void loadChatEligiblePeople({ myOrgs, myUserId }).then((list) => {
      if (!cancelled) setEligible(list);
    });
    return () => {
      cancelled = true;
    };
  }, [open, myOrgs, myUserId]);

  const candidates = useMemo(() => {
    const inChannel = new Set(members.map((m) => m.userId));
    return eligible.filter((p) => !inChannel.has(p.userId));
  }, [eligible, members]);

  const run = async (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await fn();
      if (err) setError(err);
    } finally {
      setBusy(false);
    }
  };

  const onPickIcon = (file: File | null) => {
    if (!file) return;
    void run(async () => {
      const res = await setChannelIcon(entry.id, file);
      if (!res.error) setIconPicker(false);
      return res;
    });
  };

  const onPickPreset = (presetId: string) => {
    void run(async () => {
      const res = await setChannelIconPreset(entry.id, presetId);
      if (!res.error) setIconPicker(false);
      return res;
    });
  };

  const togglePick = (userId: string) => {
    const next = new Set(pickIds);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    setPickIds(next);
  };

  const addSelected = async () => {
    if (pickIds.size === 0) return;
    setError(null);
    setBusy(true);
    try {
      for (const id of pickIds) {
        const { error: err } = await inviteMember(entry.id, id);
        if (err) {
          setError(err);
          break;
        }
      }
      setPickIds(new Set());
      setAdding(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} width={420}>
      <div className="p-4 pr-10">
        <div className="mb-3 text-sm font-semibold text-ink">Zarządzaj kanałem</div>
        <div className="mb-4 text-[11px] text-ink-faint">
          Administratorzy mogą dodawać i usuwać osoby, nadawać uprawnienia oraz zmieniać
          ikonę. Zawsze musi zostać przynajmniej jeden administrator.
        </div>

        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => setIconPicker((v) => !v)}
            className="group relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-line bg-surface-raised text-ink-faint transition hover:border-accent/40"
            title="Zmień ikonę"
          >
            {entry.iconUrl ? (
              <ChannelIcon
                iconUrl={entry.iconUrl}
                size={56}
                className="!h-full !w-full rounded-full"
              />
            ) : (
              <ChannelIcon iconUrl={null} size={22} />
            )}
            <span className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition group-hover:opacity-100">
              <Camera size={16} className="text-white" />
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              e.target.value = "";
              onPickIcon(f);
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink">{entry.name}</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => setIconPicker((v) => !v)}
                className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-light transition hover:border-line-strong hover:text-ink"
              >
                {iconPicker ? "Zamknij ikony" : "Ustaw ikonę"}
              </button>
              {entry.iconUrl && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const res = entry.iconUrl?.startsWith("preset:")
                        ? await setChannelIconPreset(entry.id, null)
                        : await setChannelIcon(entry.id, null);
                      return res;
                    })
                  }
                  className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-light transition hover:border-line-strong hover:text-ink"
                >
                  Usuń ikonę
                </button>
              )}
            </div>
          </div>
        </div>

        {iconPicker && (
          <div className="mb-4 rounded-xl border border-line bg-surface-raised/60 p-3">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Propozycje
            </div>
            <div className="grid grid-cols-8 gap-1.5">
              {CHANNEL_ICON_PRESETS.map((p) => {
                const active = activePresetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={busy}
                    title={p.label}
                    onClick={() => onPickPreset(p.id)}
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-base transition hover:scale-105 disabled:opacity-50 ${
                      active
                        ? "ring-2 ring-accent ring-offset-1 ring-offset-surface"
                        : "hover:ring-1 hover:ring-line-strong"
                    }`}
                    style={{ background: p.bg }}
                  >
                    <span aria-hidden>{p.emoji}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-2 text-[12px] font-medium text-ink transition hover:border-line-strong disabled:opacity-50"
            >
              <Upload size={13} />
              Wgraj własne zdjęcie…
            </button>
          </div>
        )}

        <div className="mb-1 flex items-center justify-between">
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Członkowie · {members.length}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setAdding((v) => !v);
              setPickIds(new Set());
            }}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-accent transition hover:bg-accent/10"
          >
            <UserPlus size={12} /> Dodaj
          </button>
        </div>

        {adding && (
          <div className="mb-3 rounded-lg border border-line bg-surface-raised/50 p-2">
            {candidates.length === 0 ? (
              <div className="px-1 py-2 text-center text-[11px] text-ink-faint">
                Brak osób do dodania.
              </div>
            ) : (
              <div className="thin-scrollbar max-h-36 overflow-y-auto">
                {candidates.map((p) => (
                  <label
                    key={p.userId}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-raised"
                  >
                    <input
                      type="checkbox"
                      checked={pickIds.has(p.userId)}
                      onChange={() => togglePick(p.userId)}
                      className="accent-[#4A8FC4]"
                    />
                    <PersonAvatar userId={p.userId} avatarUrl={p.avatarUrl} size={20} />
                    <span className="truncate text-xs text-ink">
                      {p.displayName || "Bez nazwy"}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="mt-2 flex justify-end gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setPickIds(new Set());
                }}
                className="rounded-md px-2 py-1 text-[11px] text-ink-light hover:text-ink"
              >
                Anuluj
              </button>
              <button
                type="button"
                disabled={busy || pickIds.size === 0}
                onClick={() => void addSelected()}
                className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50"
              >
                Dodaj wybrane
              </button>
            </div>
          </div>
        )}

        <div className="thin-scrollbar mb-3 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface-raised/40">
          {members.map((m) => {
            const admin = isAdminRole(m.role);
            const isMe = m.userId === myUserId;
            const canDemote = admin && adminCount > 1;
            return (
              <div
                key={m.userId}
                className="flex items-center gap-2 border-b border-line/50 px-2.5 py-2 last:border-b-0"
              >
                <PersonAvatar
                  userId={m.userId}
                  avatarUrl={m.avatarUrl}
                  size={28}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-ink">
                    {m.displayName || "Bez nazwy"}
                    {isMe ? " (ty)" : ""}
                  </div>
                  <div className="text-[10px] text-ink-faint">
                    {m.role === "owner"
                      ? "Właściciel"
                      : m.role === "admin"
                        ? "Administrator"
                        : "Członek"}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  {admin ? (
                    <button
                      type="button"
                      disabled={busy || !canDemote}
                      title={
                        canDemote
                          ? "Odbierz uprawnienia administratora"
                          : "Musi zostać przynajmniej jeden administrator"
                      }
                      onClick={() =>
                        void run(() => setChannelMemberRole(entry.id, m.userId, "member"))
                      }
                      className="rounded-md p-1.5 text-ink-light transition hover:bg-surface-overlay hover:text-ink disabled:opacity-30"
                    >
                      <ShieldOff size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      title="Nadaj uprawnienia administratora"
                      onClick={() =>
                        void run(() => setChannelMemberRole(entry.id, m.userId, "admin"))
                      }
                      className="rounded-md p-1.5 text-ink-light transition hover:bg-surface-overlay hover:text-ink disabled:opacity-30"
                    >
                      <Shield size={14} />
                    </button>
                  )}
                  {!isMe && (
                    <button
                      type="button"
                      disabled={busy || (admin && !canDemote)}
                      title="Usuń z kanału"
                      onClick={() => {
                        if (!confirm(`Usunąć ${m.displayName || "osobę"} z kanału?`)) return;
                        void run(() => removeMember(entry.id, m.userId));
                      }}
                      className="rounded-md p-1.5 text-red-400/80 transition hover:bg-surface-overlay hover:text-red-400 disabled:opacity-30"
                    >
                      <UserMinus size={14} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {error && <div className="mb-2 text-xs text-red-400">{error}</div>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                !confirm(
                  entry.myArchivedAt
                    ? "Przywrócić kanał z archiwum?"
                    : "Zarchiwizować kanał? Będzie widoczny tylko w sekcji Archiwum.",
                )
              ) {
                return;
              }
              void run(async () => {
                const { error: err } = await archiveConversation(
                  entry.id,
                  !entry.myArchivedAt,
                );
                if (err) return { error: err };
                onClose();
                if (!entry.myArchivedAt) {
                  useChatStore.getState().setActiveConversation(null);
                  useChatStore.getState().setPanelMode("todo");
                }
                return {};
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm text-ink-light transition hover:border-line-strong hover:text-ink disabled:opacity-50"
          >
            <Archive size={14} />
            {entry.myArchivedAt ? "Przywróć z archiwum" : "Archiwizuj kanał"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-3 py-1.5 text-sm text-ink-light transition hover:border-line-strong hover:text-ink"
          >
            Zamknij
          </button>
        </div>
      </div>
    </Modal>
  );
}
