import type { DualVisibilityMode, GoogleConnectionStatus, GoogleSyncSettings } from "@/types";
import { cloudEnabled, supabase } from "@/lib/supabase";

function functionsBase(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  if (!url) return null;
  return `${url}/functions/v1`;
}

async function authHeaders(): Promise<Record<string, string> | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    "Content-Type": "application/json",
  };
}

async function fnFetch(path: string, init?: RequestInit) {
  const base = functionsBase();
  const headers = await authHeaders();
  if (!base || !headers) throw new Error("Wymagane logowanie w chmurze (Supabase).");
  const res = await fetch(`${base}/${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? res.statusText);
  return data;
}

export function googleIntegrationAvailable(): boolean {
  return cloudEnabled;
}

export async function fetchGoogleStatus(): Promise<GoogleConnectionStatus> {
  const data = await fnFetch("google-oauth?action=status");
  return {
    connected: Boolean(data.connected),
    email: data.email ?? null,
    connectedAt: data.connectedAt ?? null,
    settings: data.settings ? rowToSettings(data.settings) : null,
    lastSyncAt: data.lastSyncAt ?? null,
    lastSyncError: data.lastSyncError ?? null,
  };
}

function rowToSettings(row: Record<string, unknown>): GoogleSyncSettings {
  return {
    calendarEnabled: (row.calendar_enabled as boolean) ?? true,
    tasksEnabled: (row.tasks_enabled as boolean) ?? true,
    calendarId: (row.calendar_id as string) ?? "primary",
    taskListId: (row.task_list_id as string) ?? "@default",
    dualVisibilityMode: (row.dual_visibility_mode as DualVisibilityMode) ?? "both_linked",
    syncCompletedTasks: (row.sync_completed_tasks as boolean) ?? false,
    importExistingOnConnect: (row.import_existing_on_connect as boolean) ?? true,
  };
}

function settingsToRow(s: GoogleSyncSettings) {
  return {
    calendar_enabled: s.calendarEnabled,
    tasks_enabled: s.tasksEnabled,
    calendar_id: s.calendarId,
    task_list_id: s.taskListId,
    dual_visibility_mode: s.dualVisibilityMode,
    sync_completed_tasks: s.syncCompletedTasks,
    import_existing_on_connect: s.importExistingOnConnect,
  };
}

export async function startGoogleConnect(): Promise<void> {
  const data = await fnFetch("google-oauth?action=start&json=1", {
    headers: { Accept: "application/json" },
  });
  if (data.url) window.location.href = data.url as string;
}

export async function disconnectGoogle(): Promise<void> {
  await fnFetch("google-oauth?action=disconnect", { method: "GET" });
}

export async function saveGoogleSettings(settings: GoogleSyncSettings): Promise<void> {
  await fnFetch("google-sync", {
    method: "POST",
    body: JSON.stringify({ settings: settingsToRow(settings) }),
  });
}

export async function triggerGoogleSync(
  action: "push" | "pull" | "full" = "full",
): Promise<void> {
  await fnFetch("google-sync", {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export async function enqueueGoogleSync(itemIds?: string[]): Promise<void> {
  await fnFetch("google-sync", {
    method: "POST",
    body: JSON.stringify({
      enqueue: true,
      action: itemIds?.length ? "push" : "full",
      itemIds,
    }),
  });
}

export async function fetchGoogleCalendars(): Promise<{ id: string; summary: string; primary?: boolean }[]> {
  const data = await fnFetch("google-sync?list=calendars");
  return data.calendars ?? [];
}

export async function fetchGoogleTaskLists(): Promise<{ id: string; title: string }[]> {
  const data = await fnFetch("google-sync?list=tasklists");
  return data.taskLists ?? [];
}

export const DEFAULT_GOOGLE_SETTINGS: GoogleSyncSettings = {
  calendarEnabled: true,
  tasksEnabled: true,
  calendarId: "primary",
  taskListId: "@default",
  dualVisibilityMode: "both_linked",
  syncCompletedTasks: false,
  importExistingOnConnect: true,
};
