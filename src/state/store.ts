import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Group, Item, Settings } from "@/types";
import { idbStorage } from "@/lib/idbStorage";
import { createItem, defaultGroups, uid, migrateGroupColor } from "@/lib/factory";
import { ensureArchiveGroup, ensureGoogleGroup, findArchiveGroup, findGoogleGroup, isArchiveGroup, isSystemGroup, patchForTaskDone, ARCHIVE_GROUP_NAME, sortGroupsForRail } from "@/lib/groups";
import { startOfDay } from "date-fns";

interface AppState {
  items: Record<string, Item>;
  groups: Group[];
  settings: Settings;
  clipboard: Item | null;
  /** Currently open item editor (id) or "new" placeholder. */
  editingId: string | null;
  /** Uncommitted new item being edited in the side panel (not yet on calendar). */
  draft: Item | null;
  /** null = ALL; inaczej filtruj po id grupy. */
  activeGroupFilter: string | null;
  hydrated: boolean;

  // actions
  upsertItem: (item: Item) => void;
  patchItem: (id: string, patch: Partial<Item>) => void;
  toggleTaskDone: (id: string) => void;
  addItem: (partial: Partial<Item>) => Item;
  deleteItem: (id: string) => void;
  duplicateItem: (id: string) => Item | null;

  /** Start a new, uncommitted draft and open it in the side panel. */
  startDraft: (partial: Partial<Item>) => void;
  patchDraft: (patch: Partial<Item>) => void;
  /** Commit the draft to the calendar/list (only meaningful if it has content). */
  commitDraft: () => void;
  discardDraft: () => void;

  copyToClipboard: (id: string) => void;
  pasteAt: (start: Date, groupId?: string | null) => Item | null;

  addGroup: (name: string, color: string) => Group;
  patchGroup: (id: string, patch: Partial<Group>) => void;
  moveGroup: (id: string, direction: "up" | "down") => void;
  deleteGroup: (id: string) => void;
  setActiveGroupFilter: (id: string | null) => void;

  setSettings: (patch: Partial<Settings>) => void;
  setEditing: (id: string | null) => void;
  /** Close the editor; discards the item if it is still an untouched empty draft. */
  closeEditor: () => void;
}

function isEmptyDraft(it: Item): boolean {
  return (
    it.title.trim() === "" &&
    it.description.trim() === "" &&
    it.checklist.length === 0 &&
    it.participants.length === 0 &&
    it.attachments.length === 0
  );
}

function defaultSettings(): Settings {
  return {
    dayStartHour: 7,
    dayEndHour: 18,
    view: "eleven",
    anchorDate: startOfDay(new Date()).toISOString(),
    nineDayStartWeekday: 5,
    hourHeight: 52,
    settingsVersion: 5,
  };
}

function migrateRehydratedState(state: Partial<AppState> | undefined) {
  const settings = state?.settings ?? defaultSettings();
  if ((settings.view as string) === "nine") settings.view = "eleven";
  if ((settings.settingsVersion ?? 0) < 2) {
    settings.view = "eleven";
    settings.settingsVersion = 2;
  }
  let groups = state?.groups?.length ? state.groups : defaultGroups();
  if ((settings.settingsVersion ?? 0) < 3) {
    groups = groups.map((g) => ({ ...g, color: migrateGroupColor(g.color) }));
    settings.settingsVersion = 3;
  }
  groups = ensureArchiveGroup(groups);
  groups = ensureGoogleGroup(groups);
  const archive = findArchiveGroup(groups)!;
  const googleGroup = findGoogleGroup(groups)!;
  if ((settings.settingsVersion ?? 0) < 4) {
    groups = groups.map((g) =>
      isArchiveGroup(g) ? { ...g, system: "archive" as const, sortOrder: 9999 } : g,
    );
    settings.settingsVersion = 4;
  }
  if ((settings.settingsVersion ?? 0) < 5) {
    groups = groups.map((g) =>
      isArchiveGroup(g)
        ? { ...g, name: ARCHIVE_GROUP_NAME, system: "archive" as const, sortOrder: 9999 }
        : g,
    );
    settings.settingsVersion = 5;
  }
  let items = state?.items
    ? Object.fromEntries(
        Object.entries(state.items).map(([id, it]) => {
          let next = { ...it, hasDueDate: it.hasDueDate ?? true };
          if (next.type === "task" && next.done && next.groupId !== archive.id) {
            next = {
              ...next,
              preArchiveGroupId: next.groupId,
              groupId: archive.id,
            };
          }
          // Importy z Google bez grupy → grupa „GOOGLE”.
          if (!next.groupId && next.syncSource === "google") {
            next = { ...next, groupId: googleGroup.id };
          }
          return [id, next];
        }),
      )
    : undefined;
  return { settings, groups, items, activeGroupFilter: state?.activeGroupFilter ?? null };
}

export function resetLocalUserState() {
  const groups = ensureGoogleGroup(ensureArchiveGroup(defaultGroups()));
  useStore.setState({
    items: {},
    groups,
    clipboard: null,
    editingId: null,
    draft: null,
    activeGroupFilter: null,
  });
}

export async function switchPersistUser(userId: string | null) {
  const name = userId ? `kalendarz-todo-v1-${userId}` : "kalendarz-todo-v1-local";
  useStore.persist.setOptions({ name });
  await useStore.persist.rehydrate();
  const partial = useStore.getState();
  const migrated = migrateRehydratedState(partial);
  useStore.setState({
    hydrated: true,
    groups: migrated.groups,
    settings: migrated.settings,
    activeGroupFilter: migrated.activeGroupFilter,
    items: migrated.items ?? {},
  });
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      items: {},
      groups: [],
      settings: defaultSettings(),
      clipboard: null,
      editingId: null,
      draft: null,
      activeGroupFilter: null,
      hydrated: false,

      upsertItem: (item) =>
        set((s) => ({
          items: { ...s.items, [item.id]: { ...item, updatedAt: new Date().toISOString() } },
        })),

      patchItem: (id, patch) =>
        set((s) => {
          const existing = s.items[id];
          if (!existing) return {};
          return {
            items: {
              ...s.items,
              [id]: { ...existing, ...patch, updatedAt: new Date().toISOString() },
            },
          };
        }),

      toggleTaskDone: (id) => {
        const s = get();
        const item = s.items[id];
        if (!item || item.type !== "task") return;
        const archive = findArchiveGroup(s.groups);
        if (!archive) return;
        get().patchItem(id, patchForTaskDone(item, !item.done, archive.id));
      },

      addItem: (partial) => {
        const item = createItem(partial);
        set((s) => ({ items: { ...s.items, [item.id]: item } }));
        return item;
      },

      deleteItem: (id) =>
        set((s) => {
          const next = { ...s.items };
          delete next[id];
          return { items: next, editingId: s.editingId === id ? null : s.editingId };
        }),

      duplicateItem: (id) => {
        const src = get().items[id];
        if (!src) return null;
        const copy = createItem({ ...src, id: uid(), title: src.title });
        copy.checklist = src.checklist.map((c) => ({ ...c, id: uid() }));
        copy.participants = src.participants.map((p) => ({ ...p, id: uid() }));
        copy.attachments = src.attachments.map((a) => ({ ...a, id: uid() }));
        copy.reminders = src.reminders.map((r) => ({ ...r, id: uid(), firedAt: null }));
        set((s) => ({ items: { ...s.items, [copy.id]: copy } }));
        return copy;
      },

      copyToClipboard: (id) => {
        const src = get().items[id];
        if (src) set({ clipboard: src });
      },

      pasteAt: (start, groupId) => {
        const clip = get().clipboard;
        if (!clip) return null;
        const durationMs = new Date(clip.end).getTime() - new Date(clip.start).getTime();
        const newStart = new Date(start);
        const newEnd = new Date(newStart.getTime() + durationMs);
        const copy = createItem({
          ...clip,
          id: uid(),
          start: newStart.toISOString(),
          end: newEnd.toISOString(),
          groupId: groupId !== undefined ? groupId : clip.groupId,
        });
        copy.checklist = clip.checklist.map((c) => ({ ...c, id: uid(), done: false }));
        copy.participants = clip.participants.map((p) => ({ ...p, id: uid() }));
        copy.attachments = clip.attachments.map((a) => ({ ...a, id: uid() }));
        copy.reminders = clip.reminders.map((r) => ({ ...r, id: uid(), firedAt: null }));
        set((s) => ({ items: { ...s.items, [copy.id]: copy } }));
        return copy;
      },

      addGroup: (name, color) => {
        const userGroups = get().groups.filter((g) => !isSystemGroup(g));
        const maxOrder = userGroups.reduce((m, g) => Math.max(m, g.sortOrder), -1);
        const group: Group = {
          id: uid(),
          name,
          color,
          sortOrder: maxOrder + 1,
        };
        set((s) => ({ groups: [...s.groups, group] }));
        return group;
      },

      patchGroup: (id, patch) =>
        set((s) => ({
          groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
        })),

      moveGroup: (id, direction) =>
        set((s) => {
          const target = s.groups.find((g) => g.id === id);
          if (!target || isSystemGroup(target)) return {};

          const ordered = sortGroupsForRail(s.groups);
          const idx = ordered.findIndex((g) => g.id === id);
          if (idx < 0) return {};

          const swapIdx = direction === "up" ? idx - 1 : idx + 1;
          if (swapIdx < 0 || swapIdx >= ordered.length) return {};

          const next = [...ordered];
          [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
          const sortById = new Map(next.map((g, i) => [g.id, i]));

          return {
            groups: s.groups.map((g) =>
              isSystemGroup(g) ? g : { ...g, sortOrder: sortById.get(g.id) ?? g.sortOrder },
            ),
          };
        }),

      deleteGroup: (id) =>
        set((s) => {
          const target = s.groups.find((g) => g.id === id);
          if (target && isSystemGroup(target)) return {};
          const items = { ...s.items };
          for (const key of Object.keys(items)) {
            if (items[key].groupId === id) items[key] = { ...items[key], groupId: null };
          }
          return {
            groups: s.groups.filter((g) => g.id !== id),
            items,
            activeGroupFilter: s.activeGroupFilter === id ? null : s.activeGroupFilter,
          };
        }),

      setActiveGroupFilter: (id) => set({ activeGroupFilter: id }),

      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      startDraft: (partial) => {
        const item = createItem(partial);
        set({ draft: item, editingId: item.id });
      },

      patchDraft: (patch) =>
        set((s) =>
          s.draft
            ? { draft: { ...s.draft, ...patch, updatedAt: new Date().toISOString() } }
            : {},
        ),

      commitDraft: () =>
        set((s) => {
          if (!s.draft) return { editingId: null };
          if (isEmptyDraft(s.draft)) return { draft: null, editingId: null };
          return {
            items: { ...s.items, [s.draft.id]: s.draft },
            draft: null,
            editingId: null,
          };
        }),

      discardDraft: () => set({ draft: null, editingId: null }),

      setEditing: (id) =>
        set((s) => {
          // Switching away discards any uncommitted (empty) draft.
          const base = s.draft ? { draft: null } : {};
          if (id === null) return { ...base, editingId: null };
          return { ...base, editingId: id };
        }),

      closeEditor: () =>
        set((s) => {
          // Commit a non-empty draft; otherwise discard. Then return to the list.
          if (s.draft) {
            if (isEmptyDraft(s.draft)) return { draft: null, editingId: null };
            return {
              items: { ...s.items, [s.draft.id]: s.draft },
              draft: null,
              editingId: null,
            };
          }
          return { editingId: null };
        }),
    }),
    {
      name: "kalendarz-todo-v1-local",
      storage: createJSONStorage(() => idbStorage),
      partialize: (s) => ({
        items: s.items,
        groups: s.groups,
        settings: s.settings,
        activeGroupFilter: s.activeGroupFilter,
      }),
      onRehydrateStorage: () => (state) => {
        const migrated = migrateRehydratedState(state ?? undefined);
        useStore.setState({
          hydrated: true,
          groups: migrated.groups,
          settings: migrated.settings,
          activeGroupFilter: migrated.activeGroupFilter,
          ...(migrated.items ? { items: migrated.items } : {}),
        });
      },
    },
  ),
);

export function useItemsArray(): Item[] {
  return useStore((s) => Object.values(s.items));
}
