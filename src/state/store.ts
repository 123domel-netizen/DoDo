import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Group, Item, Settings, TeamMember, UserTag } from "@/types";
import type { MyOrg } from "@/lib/orgs";
import { loadAssignableContacts } from "@/lib/contacts";
import { filterVisibleItems, isItemDeleted, itemSupportsTodoDone, tombstoneItem } from "@/lib/items";
import { idbStorage } from "@/lib/idbStorage";
import { applyTheme } from "@/lib/theme";
import { createItem, defaultGroups, uid, migrateGroupColor } from "@/lib/factory";
import {
  ensureArchiveGroup,
  ensureShareGroup,
  findArchiveGroup,
  findGoogleGroup,
  GOOGLE_GROUP_SORT_ORDER,
  isArchiveGroup,
  isGoogleGroup,
  isGroupStructureLocked,
  patchForTaskDone,
  ARCHIVE_GROUP_NAME,
  sortGroupsForRail,
  stripGoogleGroups,
} from "@/lib/groups";
import { isSharedItem } from "@/lib/share";
import { defaultTagColor, scrubTagIdFromItems, scrubTagIdFromMap } from "@/lib/tags";
import { baseItemId } from "@/lib/itemId";
import { normalizeAllDayRange } from "@/lib/allDay";
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
  teamMembers: TeamMember[];
  /** App-level admin (panel Administracja). */
  isAppAdmin: boolean;
  /** Orgi użytkownika (zespoły z planami). */
  myOrgs: MyOrg[];
  /** Aktywny zespół w UI (gdy >1). */
  activeOrgId: string | null;
  /** Komunikat po auto-accept zaproszeń przy logowaniu. */
  orgInviteNotice: string | null;
  authUserId: string | null;
  authUserEmail: string | null;
  /** Słownik tagów bieżącego użytkownika. */
  tags: Record<string, UserTag>;
  /** Prywatne przypisania tagów do itemów (uczestnik SHARE + lokalny cache). */
  myTagIdsByItem: Record<string, string[]>;
  /** Id itemu z aktywnym promptem wyboru grupy (nie persystowane). */
  groupPromptItemId: string | null;

  // actions
  upsertItem: (item: Item) => void;
  patchItem: (id: string, patch: Partial<Item>) => void;
  toggleTaskDone: (id: string) => void;
  addItem: (partial: Partial<Item>) => Item;
  deleteItem: (id: string) => void;
  /** Usuń item SHARE z lokalnego widoku (np. po odrzuceniu udziału). */
  removeSharedItem: (id: string) => void;
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
  /** Close the editor; discards uncommitted draft without saving. */
  closeEditor: () => void;

  setTeamMembers: (members: TeamMember[]) => void;
  setOrgBootstrap: (payload: {
    isAppAdmin: boolean;
    myOrgs: MyOrg[];
    activeOrgId?: string | null;
    acceptedInvites?: number;
  }) => void;
  setActiveOrgId: (id: string | null) => void;
  setMyOrgs: (orgs: MyOrg[]) => void;
  clearOrgInviteNotice: () => void;
  setAuthUser: (id: string | null, email: string | null) => void;
  dismissGroupPrompt: (itemId: string) => void;
  clearGroupPrompt: () => void;

  addTag: (name: string, color?: string) => UserTag;
  patchTag: (id: string, patch: Partial<Pick<UserTag, "name" | "color">>) => void;
  deleteTag: (id: string) => void;
  setItemTagIds: (itemId: string, tagIds: string[]) => void;
}

function maybeQueueGroupPrompt(item: Item): string | null {
  if (item.groupId || item.groupPromptDismissed || isSharedItem(item) || isItemDeleted(item))
    return null;
  return item.id;
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
    hourHeightAuto: true,
    theme: "dark",
    settingsVersion: 15,
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
  groups = ensureShareGroup(groups);
  const archive = findArchiveGroup(groups)!;
  const googleGroup = findGoogleGroup(groups);
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
          // Importy z Google bez grupy → grupa „GOOGLE” (legacy, przed v10).
          if (!next.groupId && next.syncSource === "google" && googleGroup) {
            next = { ...next, groupId: googleGroup.id };
          }
          return [id, next];
        }),
      )
    : undefined;
  if ((settings.settingsVersion ?? 0) < 6 && items) {
    items = Object.fromEntries(
      Object.entries(items).map(([id, it]) => {
        if (!it.allDay || !it.hasDueDate) return [id, it];
        const { start, end } = normalizeAllDayRange(it.start, it.end);
        if (start === it.start && end === it.end) return [id, it];
        return [id, { ...it, start, end, updatedAt: new Date().toISOString() }];
      }),
    );
    settings.settingsVersion = 6;
  }
  if ((settings.settingsVersion ?? 0) < 7) {
    groups = groups.map((g) =>
      isGoogleGroup(g) && g.hideFromAll === undefined
        ? { ...g, hideFromAll: true }
        : g,
    );
    settings.settingsVersion = 7;
  }
  if ((settings.settingsVersion ?? 0) < 8) {
    groups = groups.map((g) =>
      isGoogleGroup(g) && g.system !== "google"
        ? {
            ...g,
            system: "google" as const,
            hideFromAll: g.hideFromAll ?? true,
            sortOrder: GOOGLE_GROUP_SORT_ORDER,
          }
        : g,
    );
    settings.settingsVersion = 8;
  }
  if ((settings.settingsVersion ?? 0) < 9 && items) {
    // Integracja Kalendarz/Zadania Google została usunięta — czyścimy lokalnie
    // wszystkie zaimportowane pozycje (rozwinięte cykliczne urodziny/rocznice itd.).
    items = Object.fromEntries(
      Object.entries(items).filter(([, it]) => it.syncSource !== "google"),
    );
    settings.settingsVersion = 9;
  }
  let activeGroupFilter = state?.activeGroupFilter ?? null;
  if ((settings.settingsVersion ?? 0) < 10) {
    const googleIds = new Set(groups.filter(isGoogleGroup).map((g) => g.id));
    groups = stripGoogleGroups(groups);
    if (items) {
      items = Object.fromEntries(
        Object.entries(items).map(([id, it]) => {
          if (it.groupId && googleIds.has(it.groupId)) {
            return [id, { ...it, groupId: null, updatedAt: new Date().toISOString() }];
          }
          return [id, it];
        }),
      );
    }
    if (activeGroupFilter && googleIds.has(activeGroupFilter)) activeGroupFilter = null;
    settings.settingsVersion = 10;
  }
  if ((settings.settingsVersion ?? 0) < 11) {
    groups = ensureShareGroup(groups);
    settings.settingsVersion = 11;
  }
  let tags = state?.tags ?? {};
  let myTagIdsByItem = state?.myTagIdsByItem ?? {};
  if ((settings.settingsVersion ?? 0) < 12 && items) {
    for (const [id, it] of Object.entries(items)) {
      if (isSharedItem(it) || !it.tagIds?.length) continue;
      if (!myTagIdsByItem[id]?.length) {
        myTagIdsByItem = { ...myTagIdsByItem, [id]: [...it.tagIds] };
      }
    }
    settings.settingsVersion = 12;
  }
  if ((settings.settingsVersion ?? 0) < 13) {
    // Domyślnie siatka wypełnia panel kalendarza; ręczne hourHeight zostaje fallbackiem.
    if (settings.hourHeightAuto === undefined) settings.hourHeightAuto = true;
    settings.settingsVersion = 13;
  }
  if ((settings.settingsVersion ?? 0) < 14) {
    if (!settings.theme) settings.theme = "dark";
    settings.settingsVersion = 14;
  }
  if ((settings.settingsVersion ?? 0) < 15) {
    groups = groups.map((g) => ({ ...g, color: migrateGroupColor(g.color) }));
    tags = Object.fromEntries(
      Object.entries(tags).map(([id, tag]) => [
        id,
        { ...tag, color: migrateGroupColor(tag.color) },
      ]),
    );
    settings.settingsVersion = 15;
  }
  return { settings, groups, items, activeGroupFilter, tags, myTagIdsByItem };
}

export function resetLocalUserState() {
  const groups = ensureShareGroup(ensureArchiveGroup(defaultGroups()));
  useStore.setState({
    items: {},
    groups,
    clipboard: null,
    editingId: null,
    draft: null,
    activeGroupFilter: null,
    teamMembers: [],
    isAppAdmin: false,
    myOrgs: [],
    activeOrgId: null,
    orgInviteNotice: null,
    groupPromptItemId: null,
    tags: {},
    myTagIdsByItem: {},
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
    tags: migrated.tags ?? {},
    myTagIdsByItem: migrated.myTagIdsByItem ?? {},
  });
  applyTheme(migrated.settings.theme);
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
      teamMembers: [],
      isAppAdmin: false,
      myOrgs: [],
      activeOrgId: null,
      orgInviteNotice: null,
      authUserId: null,
      authUserEmail: null,
      groupPromptItemId: null,
      tags: {},
      myTagIdsByItem: {},

      upsertItem: (item) =>
        set((s) => ({
          items: { ...s.items, [item.id]: { ...item, updatedAt: new Date().toISOString() } },
        })),

      patchItem: (id, patch) =>
        set((s) => {
          const baseId = baseItemId(id);
          const existing = s.items[baseId];
          if (!existing || isItemDeleted(existing)) return {};
          return {
            items: {
              ...s.items,
              [baseId]: { ...existing, ...patch, updatedAt: new Date().toISOString() },
            },
          };
        }),

      toggleTaskDone: (id) => {
        const s = get();
        const baseId = baseItemId(id);
        const item = s.items[baseId];
        if (!item || isItemDeleted(item) || !itemSupportsTodoDone(item)) return;
        const archive = findArchiveGroup(s.groups);
        if (!archive) return;
        get().patchItem(baseId, patchForTaskDone(item, !item.done, archive.id));
      },

      addItem: (partial) => {
        const item = createItem(partial);
        const promptId = maybeQueueGroupPrompt(item);
        set((s) => ({
          items: { ...s.items, [item.id]: item },
          groupPromptItemId: promptId ?? s.groupPromptItemId,
        }));
        return item;
      },

      deleteItem: (id) =>
        set((s) => {
          const baseId = baseItemId(id);
          const target = s.items[baseId];
          if (!target || isSharedItem(target) || isItemDeleted(target)) return {};
          return {
            items: {
              ...s.items,
              [baseId]: tombstoneItem(target, s.authUserId),
            },
            editingId: s.editingId === baseId ? null : s.editingId,
          };
        }),

      removeSharedItem: (id) =>
        set((s) => {
          const target = s.items[id];
          if (!target || !isSharedItem(target)) return {};
          const next = { ...s.items };
          delete next[id];
          return { items: next, editingId: s.editingId === id ? null : s.editingId };
        }),

      duplicateItem: (id) => {
        const baseId = baseItemId(id);
        const src = get().items[baseId];
        if (!src) return null;
        const copy = createItem({ ...src, id: uid(), title: src.title });
        copy.checklist = src.checklist.map((c) => ({ ...c, id: uid() }));
        copy.participants = src.participants.map((p) => ({ ...p, id: uid() }));
        copy.attachments = src.attachments.map((a) => ({ ...a, id: uid() }));
        copy.reminders = src.reminders.map((r) => ({ ...r, id: uid(), firedAt: null }));
        const srcTags = get().myTagIdsByItem[baseId] ?? src.tagIds ?? [];
        set((s) => ({
          items: { ...s.items, [copy.id]: copy },
          ...(srcTags.length
            ? { myTagIdsByItem: { ...s.myTagIdsByItem, [copy.id]: [...srcTags] } }
            : {}),
        }));
        return copy;
      },

      copyToClipboard: (id) => {
        const src = get().items[baseItemId(id)];
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
        const userGroups = get().groups.filter((g) => !isGroupStructureLocked(g));
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
          if (!target || isGroupStructureLocked(target)) return {};

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
              isGroupStructureLocked(g) ? g : { ...g, sortOrder: sortById.get(g.id) ?? g.sortOrder },
            ),
          };
        }),

      deleteGroup: (id) =>
        set((s) => {
          const target = s.groups.find((g) => g.id === id);
          if (target && isGroupStructureLocked(target)) return {};
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

      setSettings: (patch) => {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
        if (patch.theme !== undefined) applyTheme(patch.theme);
      },

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
          const promptId = maybeQueueGroupPrompt(s.draft);
          return {
            items: { ...s.items, [s.draft.id]: s.draft },
            draft: null,
            editingId: null,
            groupPromptItemId: promptId ?? s.groupPromptItemId,
          };
        }),

      discardDraft: () => set({ draft: null, editingId: null }),

      setEditing: (id) =>
        set((s) => {
          const base = s.draft ? { draft: null } : {};
          const normalized = id ? baseItemId(id) : null;
          if (normalized === null) return { ...base, editingId: null };
          return { ...base, editingId: normalized };
        }),

      closeEditor: () =>
        set((s) => {
          if (s.draft) return { draft: null, editingId: null };
          return { editingId: null };
        }),

      setTeamMembers: (members) => set({ teamMembers: members }),
      setOrgBootstrap: ({ isAppAdmin, myOrgs, activeOrgId, acceptedInvites }) =>
        set((s) => {
          const preferred =
            activeOrgId !== undefined
              ? activeOrgId
              : s.activeOrgId && myOrgs.some((o) => o.id === s.activeOrgId)
                ? s.activeOrgId
                : (myOrgs[0]?.id ?? null);
          const n = acceptedInvites ?? 0;
          return {
            isAppAdmin,
            myOrgs,
            activeOrgId: preferred,
            orgInviteNotice:
              n > 0
                ? n === 1
                  ? "Dołączono do zespołu na podstawie zaproszenia."
                  : `Dołączono do ${n} zespołów na podstawie zaproszeń.`
                : s.orgInviteNotice,
          };
        }),
      setActiveOrgId: (id) => {
        set({ activeOrgId: id });
        const ownerUserId = get().authUserId;
        void loadAssignableContacts({ orgId: id, ownerUserId }).then((list) => {
          set({ teamMembers: list });
        });
      },
      setMyOrgs: (orgs) =>
        set((s) => ({
          myOrgs: orgs,
          activeOrgId:
            s.activeOrgId && orgs.some((o) => o.id === s.activeOrgId)
              ? s.activeOrgId
              : (orgs[0]?.id ?? null),
        })),
      clearOrgInviteNotice: () => set({ orgInviteNotice: null }),
      setAuthUser: (id, email) => set({ authUserId: id, authUserEmail: email }),
      dismissGroupPrompt: (itemId) =>
        set((s) => {
          const it = s.items[itemId];
          if (!it) return {};
          return {
            items: {
              ...s.items,
              [itemId]: { ...it, groupPromptDismissed: true, updatedAt: new Date().toISOString() },
            },
          };
        }),
      clearGroupPrompt: () => set({ groupPromptItemId: null }),

      addTag: (name, color) => {
        const trimmed = name.trim();
        const now = new Date().toISOString();
        const userId = get().authUserId ?? "local";
        const tag: UserTag = {
          id: uid(),
          userId,
          name: trimmed,
          color: color ?? defaultTagColor(Object.keys(get().tags).length),
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ tags: { ...s.tags, [tag.id]: tag } }));
        return tag;
      },

      patchTag: (id, patch) =>
        set((s) => {
          const existing = s.tags[id];
          if (!existing) return {};
          const name = patch.name !== undefined ? patch.name.trim() : existing.name;
          if (!name) return {};
          return {
            tags: {
              ...s.tags,
              [id]: {
                ...existing,
                ...patch,
                name,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),

      deleteTag: (id) =>
        set((s) => {
          if (!s.tags[id]) return {};
          const tags = { ...s.tags };
          delete tags[id];
          return {
            tags,
            myTagIdsByItem: scrubTagIdFromMap(s.myTagIdsByItem, id),
            items: scrubTagIdFromItems(s.items, id),
          };
        }),

      setItemTagIds: (itemId, tagIds) =>
        set((s) => {
          const baseId = baseItemId(itemId);
          const item = s.items[baseId];
          const myTagIdsByItem = { ...s.myTagIdsByItem, [baseId]: tagIds };
          if (!item) return { myTagIdsByItem };
          if (isSharedItem(item)) return { myTagIdsByItem };
          return {
            myTagIdsByItem,
            items: {
              ...s.items,
              [baseId]: {
                ...item,
                tagIds,
                updatedAt: new Date().toISOString(),
              },
            },
          };
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
        tags: s.tags,
        myTagIdsByItem: s.myTagIdsByItem,
      }),
      onRehydrateStorage: () => (state) => {
        const migrated = migrateRehydratedState(state ?? undefined);
        applyTheme(migrated.settings.theme);
        useStore.setState({
          hydrated: true,
          groups: migrated.groups,
          settings: migrated.settings,
          activeGroupFilter: migrated.activeGroupFilter,
          tags: migrated.tags ?? {},
          myTagIdsByItem: migrated.myTagIdsByItem ?? {},
          ...(migrated.items ? { items: migrated.items } : {}),
        });
      },
    },
  ),
);

export function useItemsArray(): Item[] {
  return useStore((s) => filterVisibleItems(Object.values(s.items)));
}
