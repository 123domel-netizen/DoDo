import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { cloudEnabled } from "@/lib/supabase";
import {
  AVATAR_PRESETS,
  activeAvatarPresetId,
  avatarPresetUrl,
  resolveAvatarUrl,
} from "@/lib/avatar";
import {
  clearMyAvatar,
  profileHasChosenAvatar,
  setMyAvatarPreset,
  uploadMyAvatar,
} from "@/lib/avatarUpload";

export function AvatarSettings() {
  const authUserId = useStore((s) => s.authUserId);
  const profile = useChatStore((s) =>
    authUserId ? s.profiles[authUserId] : undefined,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!cloudEnabled || !authUserId) return null;

  const chosen = profileHasChosenAvatar(profile?.avatarUrl);
  const src = resolveAvatarUrl(authUserId, profile?.avatarUrl);
  const activePreset = activeAvatarPresetId(profile?.avatarUrl);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const { error: err } = await uploadMyAvatar(authUserId, file);
    setBusy(false);
    if (err) setError(err);
    else setPickerOpen(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onPreset = async (presetId: string) => {
    setBusy(true);
    setError(null);
    const { error: err } = await setMyAvatarPreset(authUserId, presetId);
    setBusy(false);
    if (err) setError(err);
    else setPickerOpen(false);
  };

  const onClear = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await clearMyAvatar(authUserId);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Awatar
      </div>
      <div className="flex items-center gap-3">
        <img
          src={src}
          alt=""
          className="h-14 w-14 shrink-0 rounded-full border border-line bg-surface-raised object-cover"
          referrerPolicy="no-referrer"
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => void onPick(e.target.files?.[0])}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => setPickerOpen((v) => !v)}
            className="w-full rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink transition hover:border-line-strong disabled:opacity-50"
          >
            {busy ? "Zapisywanie…" : pickerOpen ? "Zamknij wybór" : "Zmień awatar"}
          </button>
          {chosen && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onClear()}
              className="w-full rounded-lg px-2.5 py-1 text-xs text-ink-faint transition hover:text-ink disabled:opacity-50"
            >
              Przywróć domyślnego ludzika
            </button>
          )}
        </div>
      </div>

      {pickerOpen && (
        <div className="mt-3 rounded-xl border border-line bg-surface-raised/60 p-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            Propozycje
          </div>
          <div className="grid grid-cols-8 gap-1.5">
            {AVATAR_PRESETS.map((p) => {
              const active = activePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  title={p.label}
                  onClick={() => void onPreset(p.id)}
                  className={`overflow-hidden rounded-full transition hover:scale-105 disabled:opacity-50 ${
                    active
                      ? "ring-2 ring-accent ring-offset-1 ring-offset-surface"
                      : "hover:ring-1 hover:ring-line-strong"
                  }`}
                >
                  <img
                    src={avatarPresetUrl(p.id) ?? undefined}
                    alt={p.label}
                    className="h-9 w-9 object-cover"
                    referrerPolicy="no-referrer"
                  />
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

      <p className="mt-2 text-[11px] leading-snug text-ink-faint">
        Domyślnie każdy ma unikalnego ludzika. Wybierz propozycję albo wgraj własne
        zdjęcie (max 5 MB).
      </p>
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
    </>
  );
}
