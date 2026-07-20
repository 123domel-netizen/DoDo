/** Proponowane ikony kanałów — zapis w `conversations.icon_url` jako `preset:{id}`. */

export interface ChannelIconPreset {
  id: string;
  label: string;
  emoji: string;
  /** Tło kółka (hex). */
  bg: string;
}

export const CHANNEL_ICON_PRESETS: ChannelIconPreset[] = [
  { id: "chat", label: "Rozmowa", emoji: "💬", bg: "#DCE8FF" },
  { id: "team", label: "Zespół", emoji: "👥", bg: "#E4D9FF" },
  { id: "orders", label: "Zamówienia", emoji: "📦", bg: "#F0E0C8" },
  { id: "shop", label: "Sklep", emoji: "🛒", bg: "#D8F0E0" },
  { id: "money", label: "Finanse", emoji: "💰", bg: "#E8F5C8" },
  { id: "calendar", label: "Terminy", emoji: "📅", bg: "#FFE0D4" },
  { id: "idea", label: "Pomysły", emoji: "💡", bg: "#FFF3C4" },
  { id: "target", label: "Cele", emoji: "🎯", bg: "#FFD6E0" },
  { id: "rocket", label: "Start", emoji: "🚀", bg: "#D4EEFF" },
  { id: "tools", label: "Praca", emoji: "🛠️", bg: "#E0E4EA" },
  { id: "docs", label: "Dokumenty", emoji: "📄", bg: "#E8E0D4" },
  { id: "megaphone", label: "Ogłoszenia", emoji: "📢", bg: "#FFDCC8" },
  { id: "star", label: "Ważne", emoji: "⭐", bg: "#FFF0C0" },
  { id: "heart", label: "Ludzie", emoji: "❤️", bg: "#FFD8E4" },
  { id: "home", label: "Biuro", emoji: "🏠", bg: "#D8EFE8" },
  { id: "globe", label: "Zewnętrzne", emoji: "🌐", bg: "#D0E8F8" },
];

const PRESET_PREFIX = "preset:";

export function channelPresetIconUrl(id: string): string {
  return `${PRESET_PREFIX}${id}`;
}

export function parseChannelPresetId(iconUrl: string | null | undefined): string | null {
  if (!iconUrl?.startsWith(PRESET_PREFIX)) return null;
  const id = iconUrl.slice(PRESET_PREFIX.length);
  return id || null;
}

export function findChannelPreset(id: string): ChannelIconPreset | undefined {
  return CHANNEL_ICON_PRESETS.find((p) => p.id === id);
}

export function isChannelPresetIconUrl(iconUrl: string | null | undefined): boolean {
  return Boolean(parseChannelPresetId(iconUrl));
}
