import { useCallback, useEffect, useState } from "react";
import { BellOff, Bell } from "lucide-react";
import { loadAssignableContacts, setOrgContactMute } from "@/lib/contacts";
import { teamMemberLabel } from "@/lib/team";
import { cloudEnabled } from "@/lib/supabase";
import { useStore } from "@/state/store";

/**
 * Kontakty = członkowie aktywnego zespołu.
 * Wyciszenie ukrywa osobę w pickerze uczestników (nie usuwa z zespołu).
 */
export function TeamSettings() {
  const teamMembers = useStore((s) => s.teamMembers);
  const setTeamMembers = useStore((s) => s.setTeamMembers);
  const myOrgs = useStore((s) => s.myOrgs);
  const activeOrgId = useStore((s) => s.activeOrgId);
  const setActiveOrgId = useStore((s) => s.setActiveOrgId);
  const authUserId = useStore((s) => s.authUserId);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const orgId = activeOrgId ?? myOrgs[0]?.id ?? null;

  const refresh = useCallback(async () => {
    if (!cloudEnabled) return;
    const list = await loadAssignableContacts({
      orgId,
      ownerUserId: authUserId,
    });
    setTeamMembers(list);
  }, [orgId, authUserId, setTeamMembers]);

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

  if (myOrgs.length === 0) {
    return (
      <p className="text-[11px] leading-snug text-ink-faint">
        Kontakty pochodzą z zespołu. Dołącz do zespołu (zaproszenie) albo poproś admina o
        utworzenie — potem osoby pojawią się tutaj automatycznie.
      </p>
    );
  }

  const toggleMute = async (memberUserId: string, muted: boolean) => {
    if (!orgId) return;
    setError(null);
    setBusyId(memberUserId);
    const res = await setOrgContactMute(orgId, memberUserId, muted);
    setBusyId(null);
    if (res.error) setError(res.error);
    else await refresh();
  };

  const active = teamMembers.filter((m) => !m.muted);
  const muted = teamMembers.filter((m) => m.muted);

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-snug text-ink-faint">
        Lista osób z aktywnego zespołu — możesz je przypisywać do zadań i wydarzeń.
        Wyciszenie ukrywa kontakt w wyborze uczestników (bez usuwania z zespołu). Zapraszanie
        nowych osób: zakładka Zespół.
      </p>

      {myOrgs.length > 1 && (
        <label className="block space-y-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            Zespół
          </span>
          <select
            value={orgId ?? ""}
            onChange={(e) => setActiveOrgId(e.target.value || null)}
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none"
          >
            {myOrgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {active.length > 0 && (
        <ul className="space-y-1.5">
          {active.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{teamMemberLabel(m)}</div>
                <div className="truncate text-[10px] text-ink-faint">{m.email}</div>
              </div>
              <button
                type="button"
                disabled={busyId === m.id}
                onClick={() => void toggleMute(m.id, true)}
                className="shrink-0 rounded-lg p-1.5 text-ink-faint transition hover:bg-surface-overlay hover:text-ink disabled:opacity-50"
                title="Wycisz kontakt"
              >
                <BellOff size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {active.length === 0 && muted.length === 0 && (
        <p className="text-[11px] text-ink-faint">
          Brak innych osób w zespole. Zaproś kogoś w zakładce Zespół.
        </p>
      )}

      {muted.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            Wyciszone
          </div>
          <ul className="space-y-1.5">
            {muted.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface px-2 py-1.5 opacity-70"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{teamMemberLabel(m)}</div>
                  <div className="truncate text-[10px] text-ink-faint">{m.email}</div>
                </div>
                <button
                  type="button"
                  disabled={busyId === m.id}
                  onClick={() => void toggleMute(m.id, false)}
                  className="shrink-0 rounded-lg p-1.5 text-ink-faint transition hover:bg-surface-overlay hover:text-ink disabled:opacity-50"
                  title="Przywróć kontakt"
                >
                  <Bell size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}
