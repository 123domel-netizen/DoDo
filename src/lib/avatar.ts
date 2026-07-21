/**
 * Awatary: własny upload w storage `avatars/`, wybrany ludzik DiceBear,
 * albo deterministyczny default z userId. Zdjęcia Google są pomijane w UI.
 */

export const AVATARS_BUCKET = "avatars";

const DICEBEAR_HOST = "api.dicebear.com";
const DICEBEAR_STYLE = "fun-emoji";

export interface AvatarPreset {
  id: string;
  label: string;
  seed: string;
  /** Stała mina — emocje „z biura”, max 2 smutne. */
  mouth: string;
  eyes: string;
}

/**
 * Galeria min jak w firmie: sukces, fokus, kawa, spotkanie, bug, piątek…
 * Max 2 wyraźnie smutne (deadline / poniedziałek).
 */
export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "shipped", label: "Po deployu", seed: "OfficeShipped", mouth: "smileLol", eyes: "stars" },
  { id: "focus", label: "Deep work", seed: "OfficeFocus", mouth: "plain", eyes: "glasses" },
  { id: "coffee", label: "Po kawie", seed: "OfficeCoffee", mouth: "smileTeeth", eyes: "shades" },
  { id: "meeting", label: "Spotkanie", seed: "OfficeMeeting", mouth: "shout", eyes: "plain" },
  { id: "bug", label: "Znowu bug", seed: "OfficeBug", mouth: "pissed", eyes: "pissed" },
  { id: "friday", label: "Piątek", seed: "OfficeFriday", mouth: "kissHeart", eyes: "wink" },
  { id: "vacation", label: "Urlop w głowie", seed: "OfficeVacation", mouth: "lilSmile", eyes: "shades" },
  { id: "nerd", label: "Nerd mode", seed: "OfficeNerd", mouth: "cute", eyes: "glasses" },
  { id: "win", label: "Wygrana", seed: "OfficeWin", mouth: "wideSmile", eyes: "love" },
  { id: "joke", label: "Żart na Slacku", seed: "OfficeJoke", mouth: "tongueOut", eyes: "wink2" },
  { id: "oneonone", label: "1:1", seed: "OfficeOneOnOne", mouth: "shy", eyes: "cute" },
  { id: "sick", label: "WFH chory", seed: "OfficeSick", mouth: "sick", eyes: "closed" },
  { id: "mask", label: "Zoom face", seed: "OfficeMask", mouth: "faceMask", eyes: "plain" },
  { id: "sleep", label: "Po nockce", seed: "OfficeSleep", mouth: "plain", eyes: "sleepClose" },
  { id: "monday", label: "Poniedziałek", seed: "OfficeMonday", mouth: "sad", eyes: "sad" },
  { id: "deadline", label: "Deadline", seed: "OfficeDeadline", mouth: "drip", eyes: "tearDrop" },
];

export type DiceBearOpts = {
  mouth?: readonly string[];
  eyes?: readonly string[];
};

export function diceBearAvatarUrl(seed: string, opts?: DiceBearOpts): string {
  const params = new URLSearchParams();
  params.set("seed", seed);
  if (opts?.mouth?.length) params.set("mouth", opts.mouth.join(","));
  if (opts?.eyes?.length) params.set("eyes", opts.eyes.join(","));
  return `https://${DICEBEAR_HOST}/9.x/${DICEBEAR_STYLE}/svg?${params.toString()}`;
}

/** Domyślny ludzik: mieszanka „biurowych” min (bez smutku). */
const DEFAULT_MOUTH = [
  "lilSmile",
  "cute",
  "wideSmile",
  "smileTeeth",
  "smileLol",
  "tongueOut",
  "shy",
  "shout",
  "plain",
  "pissed",
] as const;
const DEFAULT_EYES = [
  "cute",
  "wink",
  "wink2",
  "plain",
  "love",
  "stars",
  "shades",
  "glasses",
  "closed",
  "pissed",
] as const;

export function defaultAvatarUrl(userId: string): string {
  return diceBearAvatarUrl(userId || "anon", {
    mouth: DEFAULT_MOUTH,
    eyes: DEFAULT_EYES,
  });
}

export function avatarPresetUrl(presetId: string): string | null {
  const p = AVATAR_PRESETS.find((x) => x.id === presetId);
  if (!p) return null;
  return diceBearAvatarUrl(p.seed, { mouth: [p.mouth], eyes: [p.eyes] });
}

/** Publiczny URL DiceBear fun-emoji (wybrany ludzik). */
export function isDiceBearAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.hostname === DICEBEAR_HOST &&
      u.pathname.includes(`/${DICEBEAR_STYLE}/`)
    );
  } catch {
    return false;
  }
}

export function diceBearSeedFromUrl(url: string | null | undefined): string | null {
  if (!isDiceBearAvatarUrl(url)) return null;
  try {
    return new URL(url!).searchParams.get("seed");
  } catch {
    return null;
  }
}

export function activeAvatarPresetId(
  avatarUrl: string | null | undefined,
): string | null {
  const seed = diceBearSeedFromUrl(avatarUrl);
  if (!seed) return null;
  return AVATAR_PRESETS.find((p) => p.seed === seed)?.id ?? null;
}

/** Tylko pliki z naszego bucketa — nie Google / obce CDN. */
export function isCustomAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, "https://local.invalid");
    return (
      u.pathname.includes(`/object/public/${AVATARS_BUCKET}/`) ||
      u.pathname.includes(`/object/sign/${AVATARS_BUCKET}/`)
    );
  } catch {
    return url.includes(`/${AVATARS_BUCKET}/`);
  }
}

/** Upload lub wybrany ludzik z galerii (nie default z userId). */
export function isChosenAvatarUrl(url: string | null | undefined): boolean {
  return isCustomAvatarUrl(url) || isDiceBearAvatarUrl(url);
}

export function resolveAvatarUrl(
  userId: string,
  avatarUrl: string | null | undefined,
): string {
  if (isCustomAvatarUrl(avatarUrl) || isDiceBearAvatarUrl(avatarUrl)) {
    return avatarUrl!;
  }
  return defaultAvatarUrl(userId);
}

/** Druga osoba w DM 1:1 (null dla grupowych DM / nie-DM). */
export function dmPeerMember<T extends { userId: string }>(
  members: T[],
  myUserId: string | null | undefined,
  kind?: string,
): T | null {
  if (kind && kind !== "dm") return null;
  if (members.length === 0 || members.length > 2) return null;
  return members.find((m) => m.userId !== myUserId) ?? members[0] ?? null;
}
