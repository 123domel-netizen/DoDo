import { describe, expect, it } from "vitest";
import { PROFILES_SELECT } from "@/lib/chat/api";
import {
  CHAT_OVERVIEW_STALE_MS,
  CHAT_RECONCILE_INTERVAL_MS,
} from "@/lib/chat/refreshConstants";

describe("profiles select contract", () => {
  it("uses explicit columns never select(*)", () => {
    expect(PROFILES_SELECT.includes("*")).toBe(false);
    expect(PROFILES_SELECT).toContain("user_id");
    expect(PROFILES_SELECT).toContain("display_name");
    expect(PROFILES_SELECT).toContain("avatar_url");
    expect(PROFILES_SELECT).toContain("last_seen_at");
  });
});

describe("chat overview polling constants", () => {
  it("reconcile interval is 5 minutes not 25 seconds", () => {
    expect(CHAT_RECONCILE_INTERVAL_MS).toBe(5 * 60_000);
    expect(CHAT_OVERVIEW_STALE_MS).toBe(5 * 60_000);
    expect(CHAT_RECONCILE_INTERVAL_MS).toBeGreaterThan(25_000);
  });

  it("stale gate yields at most 96 overview reconciles per 8h when always stale", () => {
    // Timer tyka co 5 min; przy zawsze-stale overview = 8*60/5 = 96.
    // Gdy Realtime odświeża lastOverviewAt, tyknięcie pomija RPC (overviewStale=false).
    const ticks = (8 * 60 * 60_000) / CHAT_RECONCILE_INTERVAL_MS;
    expect(ticks).toBe(96);
    expect(CHAT_OVERVIEW_STALE_MS).toBe(CHAT_RECONCILE_INTERVAL_MS);
  });
});
