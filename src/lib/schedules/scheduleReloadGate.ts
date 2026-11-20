/**
 * Bramka pełnego reloadu schedules: cooldown 60 min, debounce focus/visibility,
 * single-flight + cross-tab lease.
 */

import { tryAcquireAutoPullLeadership } from "@/lib/cloudPullCrossTab";

export const SCHEDULE_RELOAD_COOLDOWN_MS = 60 * 60_000;
export const SCHEDULE_FOCUS_DEBOUNCE_MS = 5_000;

let lastSuccessfulReloadAt = 0;
let lastOrgId: string | null = null;
let inFlight: Promise<{ ran: boolean; reason?: string }> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function resetScheduleReloadGateForTests(): void {
  lastSuccessfulReloadAt = 0;
  lastOrgId = null;
  inFlight = null;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export function getScheduleReloadDiagnostics() {
  return {
    lastSuccessfulReloadAt: lastSuccessfulReloadAt || null,
    lastOrgId,
    inFlight: Boolean(inFlight),
    cooldownMs: SCHEDULE_RELOAD_COOLDOWN_MS,
  };
}

export function noteScheduleOrgChange(orgId: string | null): void {
  if (orgId !== lastOrgId) {
    lastOrgId = orgId;
    lastSuccessfulReloadAt = 0;
  }
}

export type ScheduleReloadSource =
  | "focus"
  | "visibility"
  | "manual"
  | "org-change"
  | "boot";

export async function runScheduleReload(
  orgId: string,
  source: ScheduleReloadSource,
  reload: () => Promise<void>,
  now = Date.now(),
): Promise<{ ran: boolean; reason?: string }> {
  noteScheduleOrgChange(orgId);

  if (source === "focus" || source === "visibility") {
    if (
      lastSuccessfulReloadAt > 0 &&
      now - lastSuccessfulReloadAt < SCHEDULE_RELOAD_COOLDOWN_MS
    ) {
      return { ran: false, reason: "fresh" };
    }
  }

  if (inFlight) return { ran: false, reason: "single-flight" };

  const work = async () => {
    const lock = await tryAcquireAutoPullLeadership(
      orgId,
      async () => {
        await reload();
        lastSuccessfulReloadAt = Date.now();
      },
      "schedules-reload",
    );
    if (!lock.acquired) return { ran: false as const, reason: "cross-tab" };
    return { ran: true as const };
  };

  inFlight = work();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Wspólny debounce dla focus + visibility → max jeden reload. */
export function scheduleDebouncedScheduleReload(
  orgId: string,
  source: "focus" | "visibility",
  reload: () => Promise<void>,
): void {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return;
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runScheduleReload(orgId, source, reload);
  }, SCHEDULE_FOCUS_DEBOUNCE_MS);
}
