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

/** Ile propozycji pokazać w pickerze (losowo z pełnej puli). */
export const AVATAR_SUGGESTION_COUNT = 16;

/**
 * Pełna galeria min „z biura”. W UI losujemy subset — patrz `sampleAvatarPresets`.
 * Max kilka wyraźnie smutnych (deadline / poniedziałek / review).
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
  { id: "standup", label: "Stand-up", seed: "OfficeStandup", mouth: "shout", eyes: "glasses" },
  { id: "pr-merged", label: "PR merged", seed: "OfficePrMerged", mouth: "wideSmile", eyes: "stars" },
  { id: "pair", label: "Pair programming", seed: "OfficePair", mouth: "cute", eyes: "wink" },
  { id: "design", label: "Design review", seed: "OfficeDesign", mouth: "shy", eyes: "love" },
  { id: "hotfix", label: "Hotfix", seed: "OfficeHotfix", mouth: "pissed", eyes: "plain" },
  { id: "demo", label: "Demo day", seed: "OfficeDemo", mouth: "smileTeeth", eyes: "wink2" },
  { id: "retro", label: "Retro", seed: "OfficeRetro", mouth: "lilSmile", eyes: "cute" },
  { id: "lunch", label: "Lunch break", seed: "OfficeLunch", mouth: "tongueOut", eyes: "shades" },
  { id: "brainstorm", label: "Burza mózgów", seed: "OfficeBrainstorm", mouth: "smileLol", eyes: "plain" },
  { id: "quiet", label: "Quiet hours", seed: "OfficeQuiet", mouth: "plain", eyes: "closed2" },
  { id: "ops", label: "On-call", seed: "OfficeOnCall", mouth: "plain", eyes: "glasses" },
  { id: "ship-it", label: "Ship it", seed: "OfficeShipIt", mouth: "kissHeart", eyes: "love" },
  { id: "coffee2", label: "Druga kawa", seed: "OfficeCoffee2", mouth: "smileTeeth", eyes: "stars" },
  { id: "slack", label: "Thread na 40", seed: "OfficeSlackThread", mouth: "drip", eyes: "closed" },
  { id: "okrs", label: "OKR planning", seed: "OfficeOkr", mouth: "shy", eyes: "glasses" },
  { id: "client", label: "Call z klientem", seed: "OfficeClient", mouth: "faceMask", eyes: "shades" },
  { id: "docs", label: "Piszę docs", seed: "OfficeDocs", mouth: "cute", eyes: "plain" },
  { id: "ci", label: "CI zielone", seed: "OfficeCiGreen", mouth: "wideSmile", eyes: "wink" },
  { id: "ci-red", label: "CI czerwone", seed: "OfficeCiRed", mouth: "pissed", eyes: "tearDrop" },
  { id: "mentor", label: "Mentoring", seed: "OfficeMentor", mouth: "lilSmile", eyes: "cute" },
  { id: "party", label: "Team party", seed: "OfficeParty", mouth: "smileLol", eyes: "love" },
  { id: "gym", label: "Po treningu", seed: "OfficeGym", mouth: "smileTeeth", eyes: "wink2" },
  { id: "rain", label: "Deszcz za oknem", seed: "OfficeRain", mouth: "plain", eyes: "sad" },
  { id: "sun", label: "Słońce w biurze", seed: "OfficeSun", mouth: "wideSmile", eyes: "shades" },
  { id: "late", label: "Spóźniony train", seed: "OfficeLate", mouth: "shout", eyes: "pissed" },
  { id: "idea", label: "Eureka", seed: "OfficeIdea", mouth: "smileLol", eyes: "stars" },
  { id: "focus2", label: "Flow state", seed: "OfficeFlow", mouth: "plain", eyes: "closed2" },
  { id: "snack", label: "Przekąska", seed: "OfficeSnack", mouth: "tongueOut", eyes: "cute" },
  { id: "wifi", label: "Wi‑Fi padło", seed: "OfficeWifi", mouth: "sad", eyes: "crying" },
  { id: "promo", label: "Awans?", seed: "OfficePromo", mouth: "shy", eyes: "love" },
  { id: "review", label: "Code review", seed: "OfficeReview", mouth: "plain", eyes: "glasses" },
  { id: "launch", label: "Launch day", seed: "OfficeLaunch", mouth: "kissHeart", eyes: "stars" },
  { id: "chill", label: "Chill Friday", seed: "OfficeChill", mouth: "lilSmile", eyes: "wink" },
  { id: "night", label: "Północny push", seed: "OfficeNightPush", mouth: "sick", eyes: "sleepClose" },
];

/** Losowe N propozycji z puli; `preferId` zawsze w zestawie (jeśli istnieje). */
export function sampleAvatarPresets(
  count = AVATAR_SUGGESTION_COUNT,
  preferId?: string | null,
): AvatarPreset[] {
  const n = Math.min(Math.max(1, count), AVATAR_PRESETS.length);
  const pool = AVATAR_PRESETS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = a;
  }
  const preferred = preferId
    ? AVATAR_PRESETS.find((p) => p.id === preferId) ?? null
    : null;
  if (!preferred) return pool.slice(0, n);
  const rest = pool.filter((p) => p.id !== preferred.id).slice(0, n - 1);
  return [preferred, ...rest];
}

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
