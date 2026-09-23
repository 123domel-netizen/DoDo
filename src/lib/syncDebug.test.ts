import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.stubGlobal("localStorage", {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => {
    store.set(key, String(value));
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
});

vi.mock("@/state/store", () => ({
  useStore: {
    getState: () => ({ items: {}, authUserId: null }),
    setState: () => {},
    subscribe: () => () => {},
    persist: {
      setOptions: () => {},
      rehydrate: async () => {},
    },
  },
}));

vi.mock("idb-keyval", () => ({
  get: async () => null,
  set: async () => {},
  del: async () => {},
}));

import {
  beginSyncDebugCorrelation,
  clearSyncDebugTrace,
  getSyncDebugTrace,
  getWatchedItemId,
  isSyncDebugEnabled,
  isWatchedItem,
  syncDebugTrace,
} from "@/lib/syncDebug";

describe("syncDebug (observer-only)", () => {
  beforeEach(() => {
    clearSyncDebugTrace();
    store.clear();
  });

  afterEach(() => {
    clearSyncDebugTrace();
    store.clear();
  });

  it("is disabled by default", () => {
    expect(isSyncDebugEnabled()).toBe(false);
    expect(getWatchedItemId()).toBeNull();
  });

  it("enables only when localStorage flag is exactly '1'", () => {
    localStorage.setItem("dodo-sync-debug", "true");
    expect(isSyncDebugEnabled()).toBe(false);
    localStorage.setItem("dodo-sync-debug", "1");
    expect(isSyncDebugEnabled()).toBe(true);
  });

  it("syncDebugTrace is a no-op when disabled (no console, no ring)", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    syncDebugTrace({
      itemId: "x",
      stage: "FLUSH_ENTERED",
      result: "should-not-log",
    });
    expect(getSyncDebugTrace()).toEqual([]);
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("records trace only when enabled", () => {
    localStorage.setItem("dodo-sync-debug", "1");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const corr = beginSyncDebugCorrelation();
    syncDebugTrace({
      correlationId: corr,
      itemId: "abc",
      stage: "SEND_CLICKED",
      result: "ok",
      snapshot: { title: "Bachusz podpisy" },
    });
    const trace = getSyncDebugTrace();
    expect(trace).toHaveLength(1);
    expect(trace[0]?.correlationId).toBe(corr);
    expect(trace[0]?.stage).toBe("SEND_CLICKED");
    expect(trace[0]?.itemId).toBe("abc");
    expect(info).toHaveBeenCalledOnce();
    info.mockRestore();
  });

  it("isWatchedItem requires debug flag even if watch id is set", () => {
    localStorage.setItem("dodo-sync-debug-watch-id", "watched-uuid");
    expect(isWatchedItem("watched-uuid")).toBe(false);
    localStorage.setItem("dodo-sync-debug", "1");
    expect(isWatchedItem("watched-uuid")).toBe(true);
    expect(isWatchedItem("other")).toBe(false);
  });

  it("does not expose enqueue/push/clear helpers on the public API shape", async () => {
    const mod = await import("@/lib/syncDebug");
    const names = Object.keys(mod);
    expect(names).not.toContain("enqueueItem");
    expect(names).not.toContain("flushPendingPush");
    expect(names).not.toContain("clearDirtyItems");
    expect(names).not.toContain("resetLocalUserState");
  });
});
