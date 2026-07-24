import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  cancelOrgInvite,
  fetchMyOrgs,
  fetchOrgDetail,
  inviteToOrg,
  removeOrgMember,
  renameOrg,
  setOrgMemberDisplayName,
  type OrgDetail,
} from "@/lib/orgs";
import {
  formatSeatUsage,
  orgPlanLabel,
} from "@/lib/orgsPlans";
import { cloudEnabled } from "@/lib/supabase";
import { useStore } from "@/state/store";
import { OrgStorageSettings } from "@/components/settings/OrgStorageSettings";
import { DISPLAY_NAME_MAX, patchLocalDisplayName } from "@/lib/profile";

export function OrgSettings() {
  const myOrgs = useStore((s) => s.myOrgs);
  const activeOrgId = useStore((s) => s.activeOrgId);
  const setActiveOrgId = useStore((s) => s.setActiveOrgId);
  const setMyOrgs = useStore((s) => s.setMyOrgs);
  const authUserId = useStore((s) => s.authUserId);
  const orgInviteNotice = useStore((s) => s.orgInviteNotice);
  const clearOrgInviteNotice = useStore((s) => s.clearOrgInviteNotice);

  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [email, setEmail] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberNameDraft, setMemberNameDraft] = useState("");
  const [savingMemberName, setSavingMemberName] = useState(false);

  const orgId = activeOrgId ?? myOrgs[0]?.id ?? null;
  const isAdmin = detail?.myRole === "admin";

  const refresh = useCallback(async () => {
    if (!cloudEnabled || !orgId) {
      setDetail(null);
      return;
    }
    const [orgs, d] = await Promise.all([fetchMyOrgs(), fetchOrgDetail(orgId)]);
    setMyOrgs(orgs);
    setDetail(d);
    if (d) setRenameValue(d.name);
  }, [orgId, setMyOrgs]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!cloudEnabled) {
    return (
      <p className="text-[11px] leading-snug text-ink-faint">
        Zespół wymaga konta w chmurze (Supabase).
      </p>
    );
  }

  if (myOrgs.length === 0) {
    return (
      <p className="text-[11px] leading-snug text-ink-faint">
        Nie należysz jeszcze do żadnego zespołu. Poproś administratora aplikacji o utworzenie
        zespołu albo o zaproszenie na e-mail (po zalogowaniu Google zaproszenie zostanie
        przyjęte automatycznie).
      </p>
    );
  }

  const invite = async () => {
    if (!orgId || !isAdmin) return;
    setError(null);
    setInfo(null);
    setLoading(true);
    const res = await inviteToOrg(orgId, email);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setEmail("");
    setInfo(
      "Zaproszenie zapisane. Osoba musi zalogować się Google tym samym e-mailem (bez osobnej wiadomości).",
    );
    await refresh();
  };

  const cancelInvite = async (id: string) => {
    setError(null);
    const res = await cancelOrgInvite(id);
    if (res.error) setError(res.error);
    else await refresh();
  };

  const removeMember = async (userId: string) => {
    if (!orgId) return;
    setError(null);
    const res = await removeOrgMember(orgId, userId);
    if (res.error) setError(res.error);
    else await refresh();
  };

  const saveRename = async () => {
    if (!orgId || !isAdmin) return;
    setError(null);
    const res = await renameOrg(orgId, renameValue);
    if (res.error) setError(res.error);
    else {
      setRenaming(false);
      await refresh();
    }
  };

  const startEditMemberName = (userId: string, current: string | null) => {
    setError(null);
    setEditingMemberId(userId);
    setMemberNameDraft(current?.trim() || "");
  };

  const cancelEditMemberName = () => {
    setEditingMemberId(null);
    setMemberNameDraft("");
  };

  const saveMemberName = async (userId: string) => {
    if (!orgId || !isAdmin) return;
    setError(null);
    setSavingMemberName(true);
    const res = await setOrgMemberDisplayName(orgId, userId, memberNameDraft);
    setSavingMemberName(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    const name = memberNameDraft.trim().replace(/\s+/g, " ");
    patchLocalDisplayName(userId, name);
    setEditingMemberId(null);
    setMemberNameDraft("");
    await refresh();
  };

  return (
    <div className="space-y-3">
      {orgInviteNotice && (
        <div className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 px-2 py-1.5">
          <p className="min-w-0 flex-1 text-[11px] text-ink">{orgInviteNotice}</p>
          <button
            type="button"
            onClick={() => clearOrgInviteNotice()}
            className="shrink-0 text-ink-faint hover:text-ink"
            aria-label="Zamknij"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {myOrgs.length > 1 && (
        <label className="block space-y-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            Aktywny zespół
          </span>
          <select
            value={orgId ?? ""}
            onChange={(e) => setActiveOrgId(e.target.value || null)}
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-line-strong"
          >
            {myOrgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {detail && (
        <>
          <div className="rounded-lg border border-line bg-surface-raised p-2 space-y-1">
            {renaming && isAdmin ? (
              <div className="flex gap-1">
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => void saveRename()}
                  className="rounded-lg bg-accent px-2 py-1 text-xs font-medium text-white"
                >
                  Zapisz
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRenaming(false);
                    setRenameValue(detail.name);
                  }}
                  className="rounded-lg px-2 py-1 text-xs text-ink-faint"
                >
                  Anuluj
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{detail.name}</div>
                  <div className="text-[11px] text-ink-faint">
                    Plan {orgPlanLabel(detail.planCode)} ·{" "}
                    {formatSeatUsage(detail.seatUsed, detail.seatLimit)}
                    {detail.myRole === "admin" ? " · admin" : ""}
                  </div>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setRenaming(true)}
                    className="shrink-0 text-[11px] text-accent hover:underline"
                  >
                    Zmień nazwę
                  </button>
                )}
              </div>
            )}

            {detail.overLimit && (
              <p className="text-[11px] text-amber-400">
                Zespół ma więcej osób niż pozwala plan ({detail.seatUsed}/{detail.seatLimit}).
                Nowe zaproszenia są zablokowane do czasu podniesienia limitu lub zwolnienia
                miejsca.
              </p>
            )}
            {!detail.overLimit && !detail.canInvite && detail.invitesLocked && (
              <p className="text-[11px] text-amber-400">
                Zaproszenia zablokowane przez administratora aplikacji.
              </p>
            )}
            {!detail.overLimit && !detail.canInvite && !detail.invitesLocked && isAdmin && (
              <p className="text-[11px] text-amber-400">
                Brak wolnych miejsc — nie można wysłać nowego zaproszenia.
              </p>
            )}
          </div>

          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
              Członkowie
            </div>
            <ul className="space-y-1.5">
              {detail.members.map((m) => {
                const editing = editingMemberId === m.userId;
                return (
                  <li
                    key={m.userId}
                    className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-2 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      {editing ? (
                        <input
                          value={memberNameDraft}
                          onChange={(e) => setMemberNameDraft(e.target.value)}
                          maxLength={DISPLAY_NAME_MAX}
                          autoFocus
                          placeholder="Imię i nazwisko"
                          disabled={savingMemberName}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveMemberName(m.userId);
                            if (e.key === "Escape") cancelEditMemberName();
                          }}
                          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink outline-none focus:border-accent/50 disabled:opacity-50"
                        />
                      ) : (
                        <div className="truncate text-sm text-ink">
                          {m.displayName || m.email || m.userId}
                          {m.role === "admin" ? (
                            <span className="ml-1 text-[10px] text-ink-faint">(admin)</span>
                          ) : null}
                        </div>
                      )}
                      {m.email && (m.displayName || editing) ? (
                        <div className="truncate text-[10px] text-ink-faint">{m.email}</div>
                      ) : null}
                    </div>
                    {isAdmin &&
                      (editing ? (
                        <>
                          <button
                            type="button"
                            disabled={savingMemberName || !memberNameDraft.trim()}
                            onClick={() => void saveMemberName(m.userId)}
                            className="shrink-0 rounded-lg p-1.5 text-accent transition hover:bg-accent/10 disabled:opacity-40"
                            title="Zapisz nazwę"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={savingMemberName}
                            onClick={cancelEditMemberName}
                            className="shrink-0 rounded-lg p-1.5 text-ink-faint transition hover:bg-surface disabled:opacity-40"
                            title="Anuluj"
                          >
                            <X size={14} />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditMemberName(m.userId, m.displayName)}
                          className="shrink-0 rounded-lg p-1.5 text-ink-faint transition hover:bg-surface hover:text-ink"
                          title="Zmień nazwę"
                        >
                          <Pencil size={14} />
                        </button>
                      ))}
                    {isAdmin && m.role !== "admin" && m.userId !== authUserId && !editing && (
                      <button
                        type="button"
                        onClick={() => void removeMember(m.userId)}
                        className="shrink-0 rounded-lg p-1.5 text-ink-faint transition hover:bg-red-500/10 hover:text-red-400"
                        title="Usuń z zespołu"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {(isAdmin || detail.invitations.length > 0) && (
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
                Zaproszenia
              </div>
              {detail.invitations.length > 0 ? (
                <ul className="mb-2 space-y-1.5">
                  {detail.invitations.map((inv) => (
                    <li
                      key={inv.id}
                      className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-2 py-1.5"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-ink">{inv.email}</div>
                        <div className="text-[10px] text-ink-faint">
                          ważność do {new Date(inv.expiresAt).toLocaleDateString("pl-PL")}
                        </div>
                      </div>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => void cancelInvite(inv.id)}
                          className="shrink-0 rounded-lg p-1.5 text-ink-faint transition hover:bg-red-500/10 hover:text-red-400"
                          title="Anuluj zaproszenie"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-2 text-[11px] text-ink-faint">Brak oczekujących zaproszeń.</p>
              )}

              {isAdmin && (
                <div className="space-y-1.5 rounded-lg border border-line bg-surface-raised p-2">
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="E-mail do zaproszenia"
                    type="email"
                    disabled={!detail.canInvite}
                    className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-line-strong disabled:opacity-50"
                  />
                  <button
                    type="button"
                    disabled={loading || !email.trim() || !detail.canInvite}
                    onClick={() => void invite()}
                    className="flex w-full items-center justify-center gap-1 rounded-lg bg-accent px-2 py-1.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    <Plus size={14} /> Zaproś
                  </button>
                </div>
              )}
            </div>
          )}

          <OrgStorageSettings orgId={orgId ?? detail.id} isAdmin={isAdmin} />
        </>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {info && <p className="text-[11px] text-ink-faint">{info}</p>}
    </div>
  );
}
