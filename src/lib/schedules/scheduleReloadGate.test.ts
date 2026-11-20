import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SCHEDULE_RELOAD_COOLDOWN_MS,
  resetScheduleReloadGateForTests,
  runScheduleReload,
  scheduleDebouncedScheduleReload,
} from "@/lib/schedules/scheduleReloadGate";
import {
  setCloudPullCrossTabTestHooks,
  resetCloudPullCrossTabForTests,
} from "@/lib/cloudPullCrossTab";

describe("scheduleReloadGate", () => {
  beforeEach(() => {
    resetScheduleReloadGateForTests();
    resetCloudPullCrossTabForTests();
    setCloudPullCrossTabTestHooks({ locksAvailable: false });
    vi.stubGlobal("document", { visibilityState: "visible" });
  });

  afterEach(() => {
    resetScheduleReloadGateForTests();
    resetCloudPullCrossTabForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("skips focus reload when data is fresher than 60 minutes", async () => {
    let n = 0;
    await runScheduleReload("org-1", "org-change", async () => {
      n += 1;
    });
    const again = await runScheduleReload("org-1", "focus", async () => {
      n += 1;
    });
    expect(again).toEqual({ ran: false, reason: "fresh" });
    expect(n).toBe(1);
    expect(SCHEDULE_RELOAD_COOLDOWN_MS).toBe(60 * 60_000);
  });

  it("org-change can reload immediately", async () => {
    let n = 0;
    await runScheduleReload("org-1", "boot", async () => {
      n += 1;
    });
    await runScheduleReload("org-2", "org-change", async () => {
      n += 1;
    });
    expect(n).toBe(2);
  });

  it("debounce coalesces focus+visibility into one attempt", async () => {
    vi.useFakeTimers();
    let n = 0;
    const reload = async () => {
      n += 1;
    };
    // Najpierw udany boot żeby gate nie był „świeży” z org-change path... 
    // focus skip gdy fresh — wyczyść sukces:
    resetScheduleReloadGateForTests();
    scheduleDebouncedScheduleReload("org-1", "focus", reload);
    scheduleDebouncedScheduleReload("org-1", "visibility", reload);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(n).toBe(1);
  });
});
