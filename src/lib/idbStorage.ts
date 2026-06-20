import { get, set, del } from "idb-keyval";
import type { StateStorage } from "zustand/middleware";

/** Zustand storage adapter backed by IndexedDB (works offline, larger quota). */
export const idbStorage: StateStorage = {
  getItem: async (name) => {
    const value = await get<string>(name);
    return value ?? null;
  },
  setItem: async (name, value) => {
    await set(name, value);
  },
  removeItem: async (name) => {
    await del(name);
  },
};
