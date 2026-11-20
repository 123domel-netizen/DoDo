import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { tryAutoCloudRefresh } = vi.hoisted(() => ({
  tryAutoCloudRefresh: vi.fn<(source?: string) => Promise<boolean>>(async () => true),
}));

vi.mock("@/lib/cloud", () => ({
  tryAutoCloudRefresh,
}));

vi.mock("@/lib/supabase", () => ({
  cloudEnabled: true,
}));

import {
  AUTO_PULL_INTERVAL_MS,
  FOCUS_VISIBILITY_DEBOUNCE_MS,
} from "@/lib/cloudPullGate";
import {
  getAutoCloudRefreshInstallCountForTests,
  resetAutoCloudRefreshInstallForTests,
  subscribeAutoCloudRefresh,
} from "@/hooks/useAutoCloudRefresh";

type Listener = EventListenerOrEventListenerObject;

function createDomHarness() {
  const docListeners = new Map<string, Set<Listener>>();
  const winListeners = new Map<string, Set<Listener>>();
  let visibility: DocumentVisibilityState = "visible";
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  const timeouts = new Map<number, { fn: () => void; due: number }>();
  let nextId = 1;
  let now = 0;

  const documentMock = {
    get visibilityState() {
      return visibility;
    },
    addEventListener(type: string, fn: Listener) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      docListeners.get(type)?.delete(fn);
    },
  };

  const windowMock = {
    addEventListener(type: string, fn: Listener) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      winListeners.get(type)?.delete(fn);
    },
    setInterval(fn: () => void, ms: number) {
      const id = nextId++;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval(id: number) {
      intervals.delete(id);
    },
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++;
      timeouts.set(id, { fn, due: now + ms });
      return id;
    },
    clearTimeout(id: number) {
      timeouts.delete(id);
    },
  };

  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...timeouts.entries()]) {
      if (t.due <= now) {
        timeouts.delete(id);
        t.fn();
      }
    }
  };

  const emit = (map: Map<string, Set<Listener>>, type: string) => {
    for (const fn of map.get(type) ?? []) {
      if (typeof fn === "function") fn(new Event(type));
      else fn.handleEvent(new Event(type));
    }
  };

  return {
    documentMock,
    windowMock,
    advance,
    emitDoc: (type: string) => emit(docListeners, type),
    emitWin: (type: string) => emit(winListeners, type),
    tickIntervals: () => {
      for (const { fn } of intervals.values()) fn();
    },
    docListeners,
    winListeners,
    intervals,
    timeouts,
    setVisibility(v: DocumentVisibilityState) {
      visibility = v;
    },
  };
}

describe("subscribeAutoCloudRefresh", () => {
  let harness: ReturnType<typeof createDomHarness>;

  beforeEach(() => {
    resetAutoCloudRefreshInstallForTests();
    tryAutoCloudRefresh.mockClear();
    harness = createDomHarness();
    vi.stubGlobal("document", harness.documentMock);
    vi.stubGlobal("window", harness.windowMock);
  });

  afterEach(() => {
    resetAutoCloudRefreshInstallForTests();
    vi.unstubAllGlobals();
  });

  it("installs a single shared listener set (refcount)", () => {
    const a = subscribeAutoCloudRefresh();
    const b = subscribeAutoCloudRefresh();
    expect(getAutoCloudRefreshInstallCountForTests()).toBe(2);
    expect(harness.docListeners.get("visibilitychange")?.size).toBe(1);
    expect(harness.winListeners.get("focus")?.size).toBe(1);
    expect(harness.intervals.size).toBe(1);
    expect([...harness.intervals.values()][0]?.ms).toBe(AUTO_PULL_INTERVAL_MS);

    a();
    expect(getAutoCloudRefreshInstallCountForTests()).toBe(1);
    expect(harness.docListeners.get("visibilitychange")?.size).toBe(1);

    b();
    expect(getAutoCloudRefreshInstallCountForTests()).toBe(0);
    expect(harness.docListeners.get("visibilitychange")?.size ?? 0).toBe(0);
    expect(harness.winListeners.get("focus")?.size ?? 0).toBe(0);
    expect(harness.intervals.size).toBe(0);
  });

  it("debounces focus and visibility into one pull", () => {
    subscribeAutoCloudRefresh();
    harness.emitDoc("visibilitychange");
    harness.emitWin("focus");
    expect(tryAutoCloudRefresh).not.toHaveBeenCalled();

    harness.advance(FOCUS_VISIBILITY_DEBOUNCE_MS - 1);
    expect(tryAutoCloudRefresh).not.toHaveBeenCalled();

    harness.advance(1);
    expect(tryAutoCloudRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not pull when document is hidden", () => {
    subscribeAutoCloudRefresh();
    harness.setVisibility("hidden");
    harness.emitWin("focus");
    harness.advance(FOCUS_VISIBILITY_DEBOUNCE_MS);
    expect(tryAutoCloudRefresh).not.toHaveBeenCalled();

    harness.tickIntervals();
    expect(tryAutoCloudRefresh).not.toHaveBeenCalled();
  });

  it("interval triggers auto-interval source when visible", () => {
    subscribeAutoCloudRefresh();
    harness.tickIntervals();
    expect(tryAutoCloudRefresh).toHaveBeenCalledWith("auto-interval");
  });

  it("cleans up pending debounce on dispose", () => {
    const unsub = subscribeAutoCloudRefresh();
    harness.emitWin("focus");
    expect(harness.timeouts.size).toBe(1);
    unsub();
    expect(harness.timeouts.size).toBe(0);
    harness.advance(FOCUS_VISIBILITY_DEBOUNCE_MS);
    expect(tryAutoCloudRefresh).not.toHaveBeenCalled();
  });

  it("cleanup removes visibility/focus listeners and interval timer", () => {
    const unsub = subscribeAutoCloudRefresh();
    expect(harness.docListeners.get("visibilitychange")?.size).toBe(1);
    expect(harness.winListeners.get("focus")?.size).toBe(1);
    expect(harness.intervals.size).toBe(1);
    unsub();
    expect(harness.docListeners.get("visibilitychange")?.size ?? 0).toBe(0);
    expect(harness.winListeners.get("focus")?.size ?? 0).toBe(0);
    expect(harness.intervals.size).toBe(0);
    harness.emitDoc("visibilitychange");
    harness.emitWin("focus");
    harness.tickIntervals();
    expect(tryAutoCloudRefresh).not.toHaveBeenCalled();
  });
});

describe("subscribeAutoCloudRefresh DEMO / cloud disabled", () => {
  it("does not touch Supabase when cloudEnabled is false", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase", () => ({ cloudEnabled: false }));
    vi.doMock("@/lib/cloud", () => ({
      tryAutoCloudRefresh: tryAutoCloudRefresh,
    }));
    const mod = await import("@/hooks/useAutoCloudRefresh");
    mod.resetAutoCloudRefreshInstallForTests();
    const unsub = mod.subscribeAutoCloudRefresh();
    expect(mod.getAutoCloudRefreshInstallCountForTests()).toBe(0);
    unsub();
    expect(tryAutoCloudRefresh).not.toHaveBeenCalled();
    vi.resetModules();
  });
});
