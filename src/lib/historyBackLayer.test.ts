import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissActionForLayer,
  dismissHistoryLayer,
  isHistoryLayerState,
  noteHistoryLayerPopped,
  pushHistoryLayer,
  resetHistoryBackLayerForTests,
} from "@/lib/historyBackLayer";

describe("dismissActionForLayer", () => {
  it("robi back gdy zamykana warstwa jest na wierzchu", () => {
    expect(
      dismissActionForLayer({ dodo: true, layer: true, layerId: 3 }, 3),
    ).toBe("back");
  });

  it("abandon gdy na wierzchu jest nowsza warstwa (race clearSelection→editor)", () => {
    expect(
      dismissActionForLayer({ dodo: true, layer: true, layerId: 4 }, 3),
    ).toBe("abandon");
  });

  it("abandon gdy brak stanu warstwy", () => {
    expect(dismissActionForLayer(null, 1)).toBe("abandon");
    expect(dismissActionForLayer({ dodo: true }, 1)).toBe("abandon");
  });
});

describe("isHistoryLayerState", () => {
  it("wymaga dodo+layer+layerId", () => {
    expect(isHistoryLayerState({ dodo: true, layer: true, layerId: 1 })).toBe(
      true,
    );
    expect(isHistoryLayerState({ dodo: true, layer: true })).toBe(false);
    expect(isHistoryLayerState(null)).toBe(false);
  });
});

describe("push/dismiss history stack (mock)", () => {
  type Entry = { state: unknown; url: string };
  let stack: Entry[];
  let index: number;

  afterEach(() => {
    resetHistoryBackLayerForTests();
    vi.unstubAllGlobals();
  });

  function installMockHistory() {
    stack = [{ state: null, url: "https://app.test/" }];
    index = 0;
    const listeners = new Set<() => void>();

    const history = {
      get state() {
        return stack[index]?.state ?? null;
      },
      get length() {
        return stack.length;
      },
      pushState(state: unknown, _title: string, url?: string | null) {
        stack = stack.slice(0, index + 1);
        stack.push({ state, url: String(url ?? stack[index]!.url) });
        index = stack.length - 1;
      },
      back() {
        if (index <= 0) return;
        index -= 1;
        for (const fn of listeners) fn();
      },
    };

    vi.stubGlobal("window", {
      history,
      location: { href: "https://app.test/" },
      addEventListener(type: string, fn: () => void) {
        if (type === "popstate") listeners.add(fn);
      },
      removeEventListener(type: string, fn: () => void) {
        if (type === "popstate") listeners.delete(fn);
      },
    });
    // pushHistoryLayer reads window from globalThis
    vi.stubGlobal("history", history);
  }

  it("dismiss starszej warstwy nie zdejmuje nowszej (symulacja create-task z selekcji)", async () => {
    installMockHistory();
    const selId = pushHistoryLayer();
    const editorId = pushHistoryLayer();
    expect(isHistoryLayerState(window.history.state)).toBe(true);
    expect((window.history.state as { layerId: number }).layerId).toBe(editorId);

    dismissHistoryLayer(selId);
    await Promise.resolve(); // microtask

    // Editor nadal na wierzchu — back nie został wywołany dla selekcji
    expect((window.history.state as { layerId: number }).layerId).toBe(editorId);

    // Zamknięcie edytora + auto-skip porzuconej selekcji
    noteHistoryLayerPopped(editorId);
    window.history.back();
    await Promise.resolve();
    // Po back z edytora lądujemy na porzuconej selekcji → global skip → page
    expect(window.history.state).toBeNull();
  });

  it("dismiss gdy warstwa jest na wierzchu robi back", async () => {
    installMockHistory();
    const id = pushHistoryLayer();
    dismissHistoryLayer(id);
    await Promise.resolve();
    expect(window.history.state).toBeNull();
  });
});
