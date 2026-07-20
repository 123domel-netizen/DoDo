import { useRef, useState } from "react";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { cloudEnabled } from "@/lib/supabase";
import { resolveAvatarUrl } from "@/lib/avatar";
import {
  clearMyAvatar,
  profileHasCustomAvatar,
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

  if (!cloudEnabled || !authUserId) return null;

  const custom = profileHasCustomAvatar(profile?.avatarUrl);
  const src = resolveAvatarUrl(authUserId, profile?.avatarUrl);

  const onPick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const { error: err } = await uploadMyAvatar(authUserId, file);
    setBusy(false);
    if (err) setError(err);
    if (fileRef.current) fileRef.current.value = "";
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
            onClick={() => fileRef.current?.click()}
            className="w-full rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink transition hover:border-line-strong disabled:opacity-50"
          >
            {busy ? "Zapisywanie…" : "Zmień zdjęcie"}
          </button>
          {custom && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onClear()}
              className="w-full rounded-lg px-2.5 py-1 text-xs text-ink-faint transition hover:text-ink disabled:opacity-50"
            >
              Przywróć ludzika
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-ink-faint">
        Domyślnie każdy ma unikalnego ludzika. Możesz wgrać własne zdjęcie (max 5 MB).
      </p>
      {error && <p className="mt-1 text-[11px] text-red-400">{error}</p>}
    </>
  );
}
