/**
 * Shared stage ids used by both schedule catalog and nadzór catalog.
 * Legacy nadzór id `stan-zero` maps to `stan-0`.
 */
export const STAGE_IDS = [
  "wpisy-wstepne",
  "stan-0",
  "stan-surowy-otwarty",
  "stan-surowy-zamkniety",
  "instalacje",
  "deweloperski-wew",
  "deweloperski-zew",
  "stan-pod-klucz",
  "reklamacja",
  "kontrole",
] as const;

export type StageId = (typeof STAGE_IDS)[number];

const LEGACY_MAP: Record<string, string> = {
  "stan-zero": "stan-0",
};

export function normalizeStageId(id: string): string {
  return LEGACY_MAP[id] ?? id;
}
