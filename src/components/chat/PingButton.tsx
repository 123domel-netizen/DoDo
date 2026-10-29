import { useMemo, useState } from "react";
import { BellRing, Check } from "lucide-react";
import { PersonAvatar } from "@/components/chat/PersonAvatar";
import { sendPing } from "@/lib/chat/api";
import { useChatStore } from "@/lib/chat/store";

export type PingParticipant = {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
};

type Props = {
  conversationId: string;
  participants: PingParticipant[];
  myUserId: string | null;
  /** Compact header icon style vs boards action chip. */
  variant?: "header" | "action";
  className?: string;
};

/**
 * Czerwony PING: w DM 1:1 wysyła od razu do drugiej osoby;
 * w grupie / kanale / temacie — wybór wielu osób.
 */
export function PingButton({
  conversationId,
  participants,
  myUserId,
  variant = "header",
  className = "",
}: Props) {
  const profiles = useChatStore((s) => s.profiles);
  const others = useMemo(
    () => participants.filter((p) => p.userId && p.userId !== myUserId),
    [participants, myUserId],
  );
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [sentFlash, setSentFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!myUserId || others.length === 0) return null;

  const isDmOneToOne = others.length === 1;

  const flashSent = () => {
    setSentFlash(true);
    window.setTimeout(() => setSentFlash(false), 2000);
  };

  const doSend = async (targetIds: string[]) => {
    if (busy || !targetIds.length) return;
    setBusy(true);
    setError(null);
    const res = await sendPing(conversationId, targetIds);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setSelected(new Set());
    flashSent();
  };

  const btnClass =
    variant === "action"
      ? `inline-flex items-center gap-1 rounded-md border border-red-600/40 bg-red-600/15 px-2 py-1 text-[11px] font-semibold text-red-500 transition hover:bg-red-600/25 disabled:opacity-50 ${className}`
      : `inline-flex items-center gap-1 rounded-lg bg-red-600 px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm transition hover:brightness-110 disabled:opacity-50 ${className}`;

  return (
    <div className="relative">
      <button
        type="button"
        disabled={busy}
        className={btnClass}
        aria-label="PING — pilnie zwróć uwagę"
        title="PING — potrzebuję, żebyś teraz spojrzał na tę rozmowę"
        onClick={() => {
          setError(null);
          if (isDmOneToOne) {
            void doSend([others[0]!.userId]);
            return;
          }
          setOpen((v) => !v);
        }}
      >
        {sentFlash ? <Check size={13} /> : <BellRing size={13} />}
        {sentFlash ? "Wysłano" : "PING"}
      </button>

      {error && !open && (
        <div className="absolute right-0 top-full z-50 mt-1 max-w-[14rem] rounded-lg border border-red-500/40 bg-surface-overlay px-2 py-1.5 text-[11px] text-red-400 shadow-pop">
          {error}
        </div>
      )}

      {open && !isDmOneToOne && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Zamknij wybór PINGa"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-line bg-surface-overlay p-2 shadow-pop">
            <div className="mb-1.5 px-1 text-[11px] font-medium text-ink">
              Do kogo wysłać PING?
            </div>
            <div className="thin-scrollbar max-h-52 space-y-0.5 overflow-y-auto">
              {others.map((p) => {
                const checked = selected.has(p.userId);
                const avatar =
                  profiles[p.userId]?.avatarUrl ?? p.avatarUrl ?? null;
                const name =
                  profiles[p.userId]?.displayName || p.displayName || "Bez nazwy";
                return (
                  <label
                    key={p.userId}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs text-ink transition hover:bg-surface-raised"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(p.userId)) next.delete(p.userId);
                          else next.add(p.userId);
                          return next;
                        });
                      }}
                      className="accent-red-600"
                    />
                    <PersonAvatar
                      userId={p.userId}
                      avatarUrl={avatar}
                      size={22}
                      className="shrink-0 border-0"
                    />
                    <span className="min-w-0 truncate">{name}</span>
                  </label>
                );
              })}
            </div>
            {error && (
              <div className="mt-1 px-1 text-[11px] text-red-400">{error}</div>
            )}
            <button
              type="button"
              disabled={busy || selected.size === 0}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg bg-red-600 px-2 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              onClick={() => void doSend([...selected])}
            >
              <BellRing size={13} />
              Wyślij PING ({selected.size})
            </button>
          </div>
        </>
      )}
    </div>
  );
}
