import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadHideThreadPreviews,
  saveHideThreadPreviews,
} from "./threadPreviewPref";

const USER = "user-1";
const CONV = "conv-1";

function installMemoryLocalStorage() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  return store;
}

beforeEach(() => {
  installMemoryLocalStorage();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("threadPreviewPref", () => {
  it("defaults to showing previews", () => {
    expect(loadHideThreadPreviews(USER, CONV)).toBe(false);
    expect(loadHideThreadPreviews(null, CONV)).toBe(false);
  });

  it("persists hide per user + conversation", () => {
    saveHideThreadPreviews(USER, CONV, true);
    expect(loadHideThreadPreviews(USER, CONV)).toBe(true);
    expect(loadHideThreadPreviews(USER, "other-conv")).toBe(false);
    expect(loadHideThreadPreviews("other-user", CONV)).toBe(false);
  });

  it("clears storage when show is restored", () => {
    saveHideThreadPreviews(USER, CONV, true);
    saveHideThreadPreviews(USER, CONV, false);
    expect(loadHideThreadPreviews(USER, CONV)).toBe(false);
    expect(localStorage.getItem(`dodo-hide-thread-previews-v1:${USER}:${CONV}`)).toBeNull();
  });
});
