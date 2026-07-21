import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import {
  dismissUpdatePromptForSession,
  reloadAppToLatest,
  type AppReleaseInfo,
} from "@/lib/appVersion";
import { cloudEnabled } from "@/lib/supabase";
import { useAppVersionCheck } from "@/hooks/useAppVersionCheck";

/**
 * Po zalogowaniu — informacja o nowszej wersji na serwerze.
 * „Odłóż” ukrywa do następnego uruchomienia aplikacji (sesja przeglądarki).
 */
export function AppUpdatePrompt() {
  const { stale, release, clientVersion, dismiss } = useAppVersionCheck(cloudEnabled);
  const [busy, setBusy] = useState(false);

  if (!stale) return null;

  return (
    <UpdateModal
      release={release}
      clientVersion={clientVersion}
      busy={busy}
      onUpdate={() => {
        setBusy(true);
        void reloadAppToLatest();
      }}
      onPostpone={() => {
        dismissUpdatePromptForSession();
        dismiss();
      }}
    />
  );
}

function UpdateModal({
  release,
  clientVersion,
  busy,
  onUpdate,
  onPostpone,
}: {
  release: AppReleaseInfo | null;
  clientVersion: string;
  busy: boolean;
  onUpdate: () => void;
  onPostpone: () => void;
}) {
  return (
    <Modal open onClose={onPostpone} width={400}>
      <div className="p-5 pr-10">
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <RefreshCw size={22} />
        </div>
        <h2 className="mb-1 text-base font-semibold text-ink">Wersja jest nieaktualna</h2>
        <p className="mb-4 text-sm leading-relaxed text-ink-light">
          Dostępna jest nowsza wersja DoDo. Zaktualizuj, żeby uniknąć problemów z synchronizacją
          i czatem.
        </p>
        {release?.message && (
          <p className="mb-3 rounded-lg border border-line bg-surface-raised px-2.5 py-2 text-[12px] text-ink-light">
            {release.message}
          </p>
        )}
        <p className="mb-4 text-[11px] text-ink-faint">
          Twoja wersja: <span className="font-mono">{clientVersion}</span>
          {release?.version ? (
            <>
              {" "}
              · najnowsza: <span className="font-mono">{release.version}</span>
            </>
          ) : null}
        </p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onUpdate}
            className="rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:opacity-50"
          >
            {busy ? "Aktualizowanie…" : "Zaktualizuj"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onPostpone}
            className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink transition hover:border-line-strong"
          >
            Odłóż
          </button>
          <p className="px-1 text-[11px] text-ink-faint">
            Przy „Odłóż” przypomnimy przy następnym uruchomieniu aplikacji.
          </p>
        </div>
      </div>
    </Modal>
  );
}
