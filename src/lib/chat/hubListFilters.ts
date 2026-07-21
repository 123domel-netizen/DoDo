/** Filtry list hubu (Decyzje / Notatki / Media) — klienckie, na już załadowanych wierszach. */

export type HubDatePreset = "all" | "today" | "7d" | "30d";

export interface HubListFilterState {
  query: string;
  conversationId: string | null;
  datePreset: HubDatePreset;
}

export const EMPTY_HUB_LIST_FILTERS: HubListFilterState = {
  query: "",
  conversationId: null,
  datePreset: "all",
};

export function hubListFiltersActive(f: HubListFilterState): boolean {
  return Boolean(f.query.trim()) || Boolean(f.conversationId) || f.datePreset !== "all";
}

export function hubAdvancedFiltersActive(f: Pick<HubListFilterState, "conversationId" | "datePreset">): boolean {
  return Boolean(f.conversationId) || f.datePreset !== "all";
}

function norm(s: string): string {
  return s.trim().toLocaleLowerCase("pl");
}

/** Czy tekst haystack zawiera query (case-insensitive, PL). */
export function textMatchesQuery(haystack: string | null | undefined, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  return norm(haystack ?? "").includes(q);
}

export function anyTextMatchesQuery(parts: Array<string | null | undefined>, query: string): boolean {
  const q = norm(query);
  if (!q) return true;
  return parts.some((p) => norm(p ?? "").includes(q));
}

/** Dolna granica ISO dla presetu daty (lokalny start dnia / now − N dni). */
export function datePresetSinceIso(preset: HubDatePreset, now = new Date()): string | null {
  if (preset === "all") return null;
  if (preset === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return start.toISOString();
  }
  const days = preset === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function dateMatchesPreset(iso: string | null | undefined, preset: HubDatePreset): boolean {
  if (preset === "all") return true;
  if (!iso) return false;
  const since = datePresetSinceIso(preset);
  if (!since) return true;
  return iso >= since;
}

export function conversationMatchesFilter(
  conversationId: string | null | undefined,
  filterConversationId: string | null,
): boolean {
  if (!filterConversationId) return true;
  return conversationId === filterConversationId;
}

export function matchesHubListFilters(
  row: {
    conversationId: string;
    at: string;
    textParts: Array<string | null | undefined>;
  },
  filters: HubListFilterState,
): boolean {
  if (!conversationMatchesFilter(row.conversationId, filters.conversationId)) return false;
  if (!dateMatchesPreset(row.at, filters.datePreset)) return false;
  if (!anyTextMatchesQuery(row.textParts, filters.query)) return false;
  return true;
}
