import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  addTeamMember,
  deleteTeamMember,
  fetchTeamMembers,
  updateTeamMemberDisplayName,
} from "@/lib/team";
import { cloudEnabled } from "@/lib/supabase";
import { useStore } from "@/state/store";

export function TeamSettings() {
  const teamMembers = useStore((s) => s.teamMembers);
  const setTeamMembers = useStore((s) => s.setTeamMembers);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!cloudEnabled) return;
    const list = await fetchTeamMembers();
    setTeamMembers(list);
  }, [setTeamMembers]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!cloudEnabled) {
    return (
      <p className="text-[11px] leading-snug text-ink-faint">
        Kontakty wymagają konta w chmurze (Supabase).
      </p>
    );
  }

  const add = async () => {
    setError(null);
    setLoading(true);
    const res = await addTeamMember(email, displayName || null);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setEmail("");
    setDisplayName("");
    await refresh();
  };

  const remove = async (id: string) => {
    const res = await deleteTeamMember(id);
    if (res.error) setError(res.error);
    else await refresh();
  };

  const saveName = async (id: string, name: string) => {
    const res = await updateTeamMemberDisplayName(id, name || null);
    if (res.error) setError(res.error);
    else await refresh();
  };

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-snug text-ink-faint">
        Dodaj osoby, które możesz przypisać jako uczestników zadań i wydarzeń. Bez
        zaproszeń e-mail — adres trafia na listę dozwolonych logowań.
      </p>

      {teamMembers.length > 0 && (
        <ul className="space-y-1.5">
          {teamMembers.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <input
                  defaultValue={m.displayName ?? ""}
                  placeholder={m.email}
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (m.displayName ?? "")) void saveName(m.id, v);
                  }}
                  className="w-full border-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
                />
                <div className="truncate text-[10px] text-ink-faint">{m.email}</div>
              </div>
              <button
                type="button"
                onClick={() => void remove(m.id)}
                className="shrink-0 rounded-lg p-1.5 text-ink-faint transition hover:bg-red-500/10 hover:text-red-400"
                title="Usuń z kontaktów"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1.5 rounded-lg border border-line bg-surface-raised p-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail"
          type="email"
          className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-line-strong"
        />
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Nazwa wyświetlana (opcjonalnie)"
          className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-line-strong"
        />
        <button
          type="button"
          disabled={loading || !email.trim()}
          onClick={() => void add()}
          className="flex w-full items-center justify-center gap-1 rounded-lg bg-accent px-2 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
        >
          <Plus size={14} /> Dodaj osobę
        </button>
      </div>

      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {teamMembers.length === 0 && !error && (
        <p className="text-[11px] text-ink-faint">Brak kontaktów.</p>
      )}
    </div>
  );
}
