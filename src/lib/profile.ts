import { cloudEnabled, supabase } from "@/lib/supabase";
import { useChatStore } from "@/lib/chat/store";

export const DISPLAY_NAME_MAX = 80;

/** Trim + zbija spacje; null gdy puste lub za długie. */
export function normalizeDisplayName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > DISPLAY_NAME_MAX) return null;
  return name;
}

/** Aktualizuje cache profilu i nazwę na listach rozmów. */
export function patchLocalDisplayName(userId: string, displayName: string) {
  const st = useChatStore.getState();
  const prev = st.profiles[userId];
  st.setProfiles({
    ...st.profiles,
    [userId]: {
      userId,
      displayName,
      avatarUrl: prev?.avatarUrl ?? null,
      lastSeenAt: prev?.lastSeenAt ?? null,
    },
  });
  st.setOverview(
    st.overview.map((c) => ({
      ...c,
      members: c.members.map((m) =>
        m.userId === userId ? { ...m, displayName } : m,
      ),
    })),
  );
}

/** Własna nazwa — RLS profiles update own. */
export async function setMyDisplayName(
  userId: string,
  rawName: string,
): Promise<{ error: string | null }> {
  if (!cloudEnabled || !supabase) return { error: "Brak chmury." };
  const displayName = normalizeDisplayName(rawName);
  if (!displayName) {
    return {
      error: `Podaj imię lub nazwę (1–${DISPLAY_NAME_MAX} znaków).`,
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("user_id", userId);
  if (error) return { error: error.message };

  patchLocalDisplayName(userId, displayName);
  return { error: null };
}
