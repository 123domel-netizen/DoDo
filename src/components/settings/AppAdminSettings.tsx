import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import {
  appCancelOrgInvite,
  appCreateOrg,
  appFindUserByEmail,
  appListOrgs,
  appRemoveOrgMember,
  appSetInvitesLocked,
  appSetOrgAdmin,
  appSetOrgNote,
  appSetOrgPlan,
  appSetOrgSeatLimit,
  fetchOrgDetail,
  type OrgDetail,
  type OrgListRow,
} from "@/lib/orgs";
import {
  ORG_PLAN_OPTIONS,
  formatSeatUsage,
  orgPlanLabel,
  type OrgPlanCode,
} from "@/lib/orgsPlans";
import { cloudEnabled } from "@/lib/supabase";

type View = { kind: "list" } | { kind: "detail"; orgId: string } | { kind: "create" };

export function AppAdminSettings() {
  const [view, setView] = useState<View>({ kind: "list" });
  const [rows, setRows] = useState<OrgListRow[]>([]);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summary = useMemo(() => {
    const orgs = rows.length;
    const seats = rows.reduce((a, r) => a + r.seatLimit, 0);
    const used = rows.reduce((a, r) => a + r.seatUsed, 0);
    return { orgs, seats, used };
  }, [rows]);

  const refreshList = useCallback(async () => {
    const list = await appListOrgs();
    setRows(list);
  }, []);

  const openDetail = useCallback(async (orgId: string) => {
    setError(null);
    setView({ kind: "detail", orgId });
    const d = await fetchOrgDetail(orgId);
    setDetail(d);
  }, []);

  useEffect(() => {
    if (!cloudEnabled) return;
    void refreshList();
  }, [refreshList]);

  if (!cloudEnabled) {
    return (
      <p className="text-[11px] text-ink-faint">Administracja wymaga chmury.</p>
    );
  }

  if (view.kind === "create") {
    return (
      <CreateOrgForm
        onBack={() => {
          setView({ kind: "list" });
          void refreshList();
        }}
        onCreated={(id) => void openDetail(id)}
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <OrgAdminDetail
        detail={detail}
        error={error}
        onBack={() => {
          setView({ kind: "list" });
          setDetail(null);
          void refreshList();
        }}
        onRefresh={async () => {
          const d = await fetchOrgDetail(view.orgId);
          setDetail(d);
          await refreshList();
        }}
        setError={setError}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <SummaryChip label="Zespoły" value={String(summary.orgs)} />
        <SummaryChip label="Miejsca" value={`${summary.used}/${summary.seats}`} />
        <SummaryChip
          label="Wolne"
          value={String(Math.max(0, summary.seats - summary.used))}
        />
      </div>

      <button
        type="button"
        onClick={() => setView({ kind: "create" })}
        className="flex w-full items-center justify-center gap-1 rounded-lg bg-accent px-2 py-1.5 text-sm font-medium text-white"
      >
        <Plus size={14} /> Nowy zespół
      </button>

      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => void openDetail(r.id)}
              className="w-full rounded-lg border border-line bg-surface-raised px-2 py-1.5 text-left transition hover:border-line-strong"
            >
              <div className="truncate text-sm font-medium text-ink">{r.name}</div>
              <div className="text-[10px] text-ink-faint">
                {orgPlanLabel(r.planCode)} · {formatSeatUsage(r.seatUsed, r.seatLimit)}
                {r.invitesLocked ? " · zaproszenia OFF" : ""}
              </div>
              <div className="truncate text-[10px] text-ink-faint">
                Admin: {r.adminDisplayName || r.adminEmail || "—"}
              </div>
            </button>
          </li>
        ))}
      </ul>

      {rows.length === 0 && (
        <p className="text-[11px] text-ink-faint">Brak zespołów. Utwórz pierwszy.</p>
      )}
    </div>
  );
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-raised px-1 py-1.5">
      <div className="text-sm font-semibold text-ink">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  );
}

function CreateOrgForm({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [planCode, setPlanCode] = useState<OrgPlanCode>("demo");
  const [customLimit, setCustomLimit] = useState("10");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setError(null);
    setLoading(true);
    const user = await appFindUserByEmail(adminEmail);
    if (!user) {
      setLoading(false);
      setError(
        "Nie znaleziono użytkownika o tym e-mailu. Musi się wcześniej zalogować Google.",
      );
      return;
    }
    const res = await appCreateOrg({
      name,
      adminUserId: user.userId,
      planCode,
      customLimit: planCode === "custom" ? Number(customLimit) : null,
      adminNote: note || null,
    });
    setLoading(false);
    if (res.error || !res.orgId) {
      setError(res.error ?? "Nie udało się utworzyć.");
      return;
    }
    onCreated(res.orgId);
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink"
      >
        <ChevronLeft size={14} /> Lista
      </button>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nazwa zespołu"
        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none"
      />
      <input
        value={adminEmail}
        onChange={(e) => setAdminEmail(e.target.value)}
        placeholder="E-mail admina zespołu"
        type="email"
        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none"
      />
      <select
        value={planCode}
        onChange={(e) => setPlanCode(e.target.value as OrgPlanCode)}
        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none"
      >
        {ORG_PLAN_OPTIONS.map((p) => (
          <option key={p.code} value={p.code}>
            {p.label}
            {p.defaultLimit != null ? ` (${p.defaultLimit} miejsc)` : ""}
          </option>
        ))}
      </select>
      {planCode === "custom" && (
        <input
          value={customLimit}
          onChange={(e) => setCustomLimit(e.target.value)}
          type="number"
          min={1}
          placeholder="Limit miejsc"
          className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none"
        />
      )}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Notatka wewnętrzna (opcjonalnie)"
        rows={2}
        className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none"
      />
      <button
        type="button"
        disabled={loading || !name.trim() || !adminEmail.trim()}
        onClick={() => void submit()}
        className="w-full rounded-lg bg-accent px-2 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        Utwórz
      </button>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
    </div>
  );
}

function OrgAdminDetail({
  detail,
  error,
  onBack,
  onRefresh,
  setError,
}: {
  detail: OrgDetail | null;
  error: string | null;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  setError: (e: string | null) => void;
}) {
  const [planCode, setPlanCode] = useState<OrgPlanCode>("demo");
  const [customLimit, setCustomLimit] = useState("10");
  const [seatLimit, setSeatLimit] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!detail) return;
    setPlanCode(detail.planCode);
    setCustomLimit(String(detail.seatLimit));
    setSeatLimit(String(detail.seatLimit));
    setNote(detail.adminNote ?? "");
  }, [detail]);

  if (!detail) {
    return (
      <div className="space-y-2">
        <button type="button" onClick={onBack} className="text-[11px] text-ink-faint">
          ← Lista
        </button>
        <p className="text-[11px] text-ink-faint">Ładowanie…</p>
      </div>
    );
  }

  const applyPlan = async () => {
    setError(null);
    const res = await appSetOrgPlan(
      detail.id,
      planCode,
      planCode === "custom" ? Number(customLimit) : null,
    );
    if (res.error) setError(res.error);
    else await onRefresh();
  };

  const applyLimit = async () => {
    setError(null);
    const n = Number(seatLimit);
    if (!Number.isFinite(n) || n < 1) {
      setError("Podaj poprawny limit miejsc.");
      return;
    }
    const res = await appSetOrgSeatLimit(detail.id, n);
    if (res.error) setError(res.error);
    else await onRefresh();
  };

  const applyAdmin = async () => {
    setError(null);
    const user = await appFindUserByEmail(adminEmail);
    if (!user) {
      setError("Nie znaleziono użytkownika.");
      return;
    }
    const res = await appSetOrgAdmin(detail.id, user.userId);
    if (res.error) setError(res.error);
    else {
      setAdminEmail("");
      await onRefresh();
    }
  };

  const saveNote = async () => {
    setError(null);
    const res = await appSetOrgNote(detail.id, note);
    if (res.error) setError(res.error);
    else await onRefresh();
  };

  const toggleLock = async () => {
    setError(null);
    const res = await appSetInvitesLocked(detail.id, !detail.invitesLocked);
    if (res.error) setError(res.error);
    else await onRefresh();
  };

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink"
      >
        <ChevronLeft size={14} /> Lista
      </button>

      <div>
        <div className="text-sm font-medium text-ink">{detail.name}</div>
        <div className="text-[11px] text-ink-faint">
          {orgPlanLabel(detail.planCode)} ·{" "}
          {formatSeatUsage(detail.seatUsed, detail.seatLimit)}
          {detail.overLimit ? " · ponad limit" : ""}
        </div>
      </div>

      {detail.overLimit && (
        <p className="text-[11px] text-amber-400">
          Użycie przekracza limit — zaproszenia zablokowane, członkowie nie są usuwani.
        </p>
      )}

      <section className="space-y-1.5 rounded-lg border border-line bg-surface-raised p-2">
        <div className="text-[10px] font-medium uppercase text-ink-faint">Zmień plan</div>
        <select
          value={planCode}
          onChange={(e) => setPlanCode(e.target.value as OrgPlanCode)}
          className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none"
        >
          {ORG_PLAN_OPTIONS.map((p) => (
            <option key={p.code} value={p.code}>
              {p.label}
              {p.defaultLimit != null ? ` (${p.defaultLimit})` : ""}
            </option>
          ))}
        </select>
        {planCode === "custom" && (
          <input
            value={customLimit}
            onChange={(e) => setCustomLimit(e.target.value)}
            type="number"
            min={1}
            className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none"
          />
        )}
        <button
          type="button"
          onClick={() => void applyPlan()}
          className="w-full rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-surface"
        >
          Zapisz plan
        </button>
      </section>

      <section className="space-y-1.5 rounded-lg border border-line bg-surface-raised p-2">
        <div className="text-[10px] font-medium uppercase text-ink-faint">Limit miejsc</div>
        <div className="flex gap-1">
          <input
            value={seatLimit}
            onChange={(e) => setSeatLimit(e.target.value)}
            type="number"
            min={1}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => void applyLimit()}
            className="rounded-lg border border-line px-2 py-1 text-xs font-medium"
          >
            Ustaw
          </button>
        </div>
      </section>

      <section className="space-y-1.5 rounded-lg border border-line bg-surface-raised p-2">
        <div className="text-[10px] font-medium uppercase text-ink-faint">Zmień admina</div>
        <div className="flex gap-1">
          <input
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder="E-mail nowego admina"
            type="email"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none"
          />
          <button
            type="button"
            onClick={() => void applyAdmin()}
            className="rounded-lg border border-line px-2 py-1 text-xs font-medium"
          >
            OK
          </button>
        </div>
      </section>

      <section className="space-y-1.5 rounded-lg border border-line bg-surface-raised p-2">
        <div className="text-[10px] font-medium uppercase text-ink-faint">Notatka</div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none"
        />
        <button
          type="button"
          onClick={() => void saveNote()}
          className="w-full rounded-lg border border-line px-2 py-1 text-xs font-medium"
        >
          Zapisz notatkę
        </button>
      </section>

      <button
        type="button"
        onClick={() => void toggleLock()}
        className="w-full rounded-lg border border-line px-2 py-1.5 text-xs font-medium"
      >
        {detail.invitesLocked ? "Odblokuj zaproszenia" : "Zablokuj zaproszenia"}
      </button>

      <div>
        <div className="mb-1 text-[10px] font-medium uppercase text-ink-faint">Członkowie</div>
        <ul className="space-y-1">
          {detail.members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1 text-xs"
            >
              <span className="min-w-0 truncate">
                {m.displayName || m.email} {m.role === "admin" ? "(admin)" : ""}
              </span>
              {m.role !== "admin" && (
                <button
                  type="button"
                  className="shrink-0 text-red-400"
                  onClick={() =>
                    void appRemoveOrgMember(detail.id, m.userId).then(async (r) => {
                      if (r.error) setError(r.error);
                      else await onRefresh();
                    })
                  }
                >
                  Usuń
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {detail.invitations.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase text-ink-faint">
            Zaproszenia
          </div>
          <ul className="space-y-1">
            {detail.invitations.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-line px-2 py-1 text-xs"
              >
                <span className="truncate">{inv.email}</span>
                <button
                  type="button"
                  className="shrink-0 text-red-400"
                  onClick={() =>
                    void appCancelOrgInvite(inv.id).then(async (r) => {
                      if (r.error) setError(r.error);
                      else await onRefresh();
                    })
                  }
                >
                  Anuluj
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
