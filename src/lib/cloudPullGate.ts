/**
 * Koordynacja pulli snapshotu z chmury:
 * single-flight, cooldown 60 min (po udanym snapshocie), cross-tab leadership.
 */

import {
  broadcastCloudPull,
  getCloudPullTabId,
  resetCloudPullCrossTabForTests,
  subscribeCloudPullBroadcast,
  tryAcquireAutoPullLeadership,
  type CloudPullBroadcastMessage,
} from "@/lib/cloudPullCrossTab";

export type CloudPullSource =
  | "auto-interval"
  | "auto-focus"
  | "auto-visibility"
  | "manual"
  | "realtime-reconnect"
  | "auth"
  | "boot";

/** Cooldown automatycznych pełnych snapshotów — od ostatniego *udanego* pulla. */
export const AUTO_PULL_COOLDOWN_MS = 60 * 60_000;

/** Debounce wspólny dla focus + visibilitychange. */
export const FOCUS_VISIBILITY_DEBOUNCE_MS = 5_000;

/** Interwał okresowego auto-pulla — równy cooldownowi. */
export const AUTO_PULL_INTERVAL_MS = AUTO_PULL_COOLDOWN_MS;

/** Przerwa Realtime ≥ tego progu ustawia needsCatchUp (krótsza = bez snapshotu). */
export const REALTIME_CATCHUP_THRESHOLD_MS = 5 * 60_000;

const AUTO_SOURCES = new Set<CloudPullSource>([
  "auto-interval",
  "auto-focus",
  "auto-visibility",
]);

/** Źródła omijające cooldown (pierwszy pull / ręczne / zmiana usera). */
const BYPASS_COOLDOWN = new Set<CloudPullSource>(["manual", "auth", "boot"]);

export type CloudPullSkipReason =
  | "single-flight"
  | "cooldown"
  | "snapshot-fresh"
  | "cross-tab"
  | "realtime-reconnect-skipped";

export type CloudPullGateDecision =
  | { allowed: true }
  | { allowed: false; reason: CloudPullSkipReason };

export interface CloudPullTelemetry {
  source: CloudPullSource;
  startedAt: number;
  endedAt: number | null;
  skipped: CloudPullSkipReason | null;
  tableCounts: Record<string, number>;
  /** Rozmiar odpowiedzi per tabela (Blob JSON). */
  tableBytes: Record<string, number>;
  /** Suma tableBytes. */
  totalBytes: number | null;
  /** @deprecated używaj totalBytes */
  approxBytes: number | null;
  ok: boolean | null;
  tabId: string;
  wasLeader: boolean | null;
  scopeUserId: string | null;
}

type InFlight = {
  source: CloudPullSource;
  promise: Promise<unknown>;
};

let inFlight: InFlight | null = null;
/** Ostatni *udany* pełny snapshot (lokalnie + z BroadcastChannel). */
let lastSuccessfulSnapshotAt = 0;
/** Scope usera — zmiana resetuje cooldown (nie mieszamy danych workspace). */
let scopeUserId: string | null = null;
/**
 * Po długiej przerwie Realtime (≥ REALTIME_CATCHUP_THRESHOLD_MS) focus/interval
 * może zrobić jeden catch-up mimo świeżego snapshotu. Czyszczone tylko po sukcesie.
 */
let realtimeNeedsCatchUp = false;
/** Timestamp utraty Realtime (null = aktualnie połączony / nie było dropu). */
let realtimeLostAt: number | null = null;
let lastTelemetry: CloudPullTelemetry | null = null;
let broadcastUnsub: (() => void) | null = null;

function isDev(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

function logDev(message: string, detail?: unknown): void {
  if (!isDev()) return;
  if (detail !== undefined) console.info(`[cloud-pull] ${message}`, detail);
  else console.info(`[cloud-pull] ${message}`);
}

function ensureBroadcastSubscription(): void {
  if (broadcastUnsub) return;
  broadcastUnsub = subscribeCloudPullBroadcast((msg) => {
    handleRemotePullMessage(msg);
  });
}

function handleRemotePullMessage(msg: CloudPullBroadcastMessage): void {
  if (!scopeUserId || msg.userId !== scopeUserId) return;
  if (msg.tabId === getCloudPullTabId()) return;
  if (msg.type === "pull-end" && msg.ok && msg.successfulSnapshotAt) {
    lastSuccessfulSnapshotAt = Math.max(
      lastSuccessfulSnapshotAt,
      msg.successfulSnapshotAt,
    );
    realtimeNeedsCatchUp = false;
    logDev("remote-success", {
      fromTab: msg.tabId,
      at: msg.successfulSnapshotAt,
    });
  }
}

function emptyTelemetry(
  source: CloudPullSource,
  now: number,
  skipped: CloudPullSkipReason | null,
): CloudPullTelemetry {
  return {
    source,
    startedAt: now,
    endedAt: now,
    skipped,
    tableCounts: {},
    tableBytes: {},
    totalBytes: null,
    approxBytes: null,
    ok: null,
    tabId: getCloudPullTabId(),
    wasLeader: null,
    scopeUserId,
  };
}

export function resetCloudPullGateForTests(): void {
  inFlight = null;
  lastSuccessfulSnapshotAt = 0;
  scopeUserId = null;
  realtimeNeedsCatchUp = false;
  realtimeLostAt = null;
  lastTelemetry = null;
  if (broadcastUnsub) {
    broadcastUnsub();
    broadcastUnsub = null;
  }
  resetCloudPullCrossTabForTests();
}

/**
 * Ustawia workspace/user scope. Zmiana usera zeruje cooldown i flagę catch-up,
 * żeby nie używać snapshotu poprzedniego workspace.
 */
export function setCloudPullWorkspace(userId: string | null): void {
  if (userId === scopeUserId) return;
  scopeUserId = userId;
  lastSuccessfulSnapshotAt = 0;
  realtimeNeedsCatchUp = false;
  realtimeLostAt = null;
  logDev("workspace", { userId });
}

export function getCloudPullWorkspace(): string | null {
  return scopeUserId;
}

/** @deprecated używaj noteRealtimeDisconnect + noteRealtimeReconnect */
export function markRealtimeNeedsCatchUp(): void {
  noteRealtimeDisconnect();
}

/** Zapisz moment utraty Realtime (pierwszy drop w serii). */
export function noteRealtimeDisconnect(now = Date.now()): void {
  if (realtimeLostAt == null) {
    realtimeLostAt = now;
    logDev("realtime-lost", { at: now });
  }
}

/**
 * Po reconnect: przerwa ≥ 5 min → needsCatchUp; krótsza → bez pełnego snapshotu.
 * Sam reconnect NIGDY nie odpala snapshotu.
 */
export function noteRealtimeReconnect(now = Date.now()): void {
  if (realtimeLostAt == null) return;
  const downtime = now - realtimeLostAt;
  realtimeLostAt = null;
  if (downtime >= REALTIME_CATCHUP_THRESHOLD_MS) {
    realtimeNeedsCatchUp = true;
    logDev("realtime-catchup-armed", { downtimeMs: downtime });
  } else {
    logDev("realtime-short-reconnect", { downtimeMs: downtime });
  }
}

export function clearRealtimeNeedsCatchUp(): void {
  realtimeNeedsCatchUp = false;
}

export function getRealtimeNeedsCatchUp(): boolean {
  return realtimeNeedsCatchUp;
}

export function getRealtimeLostAt(): number | null {
  return realtimeLostAt;
}

/** Test helper */
export function setRealtimeLostAtForTests(at: number | null): void {
  realtimeLostAt = at;
}

export function getLastSuccessfulSnapshotAt(): number {
  return lastSuccessfulSnapshotAt;
}

/** Test helper — ustaw ostatni udany snapshot. */
export function setLastSuccessfulSnapshotAtForTests(at: number): void {
  lastSuccessfulSnapshotAt = at;
}

export function getCloudPullGateDiagnostics() {
  return {
    inFlightSource: inFlight?.source ?? null,
    lastSuccessfulSnapshotAt: lastSuccessfulSnapshotAt || null,
    lastAutoAttemptAt: lastSuccessfulSnapshotAt || null,
    realtimeNeedsCatchUp,
    realtimeLostAt,
    realtimeCatchUpThresholdMs: REALTIME_CATCHUP_THRESHOLD_MS,
    scopeUserId,
    lastTelemetry,
    autoCooldownMs: AUTO_PULL_COOLDOWN_MS,
    tabId: getCloudPullTabId(),
  };
}

export function getLastCloudPullTelemetry(): CloudPullTelemetry | null {
  return lastTelemetry;
}

/** Czeka aż bieżący pull się skończy (np. przed bootem auth). */
export async function awaitCloudPullIdle(): Promise<void> {
  const current = inFlight;
  if (!current) return;
  try {
    await current.promise;
  } catch {
    /* ignore */
  }
}

/**
 * Decyduje, czy wolno wystartować pull (bez cross-tab — to w runCloudPull).
 * `realtime-reconnect` zawsze pomijany (krótki reconnect ≠ pełny snapshot).
 */
export function decideCloudPull(
  source: CloudPullSource,
  now = Date.now(),
  opts?: { realtimeNeedsCatchUp?: boolean },
): CloudPullGateDecision {
  ensureBroadcastSubscription();

  if (source === "realtime-reconnect") {
    lastTelemetry = emptyTelemetry(source, now, "realtime-reconnect-skipped");
    logDev("skipped", { source, reason: "realtime-reconnect-skipped" });
    return { allowed: false, reason: "realtime-reconnect-skipped" };
  }

  if (inFlight) {
    lastTelemetry = emptyTelemetry(source, now, "single-flight");
    logDev("skipped", { source, reason: "single-flight", blocking: inFlight.source });
    return { allowed: false, reason: "single-flight" };
  }

  if (BYPASS_COOLDOWN.has(source)) {
    return { allowed: true };
  }

  if (!AUTO_SOURCES.has(source)) {
    return { allowed: true };
  }

  const needsCatchUp = opts?.realtimeNeedsCatchUp ?? realtimeNeedsCatchUp;
  const sinceSuccess =
    lastSuccessfulSnapshotAt > 0 ? now - lastSuccessfulSnapshotAt : Number.POSITIVE_INFINITY;

  if (sinceSuccess < AUTO_PULL_COOLDOWN_MS && !needsCatchUp) {
    const reason: CloudPullSkipReason =
      source === "auto-focus" || source === "auto-visibility"
        ? "snapshot-fresh"
        : "cooldown";
    lastTelemetry = emptyTelemetry(source, now, reason);
    logDev("skipped", {
      source,
      reason,
      ageMs: sinceSuccess,
      remainingMs: AUTO_PULL_COOLDOWN_MS - sinceSuccess,
    });
    return { allowed: false, reason };
  }

  return { allowed: true };
}

export async function runCloudPull<T>(
  source: CloudPullSource,
  run: () => Promise<T>,
  opts?: {
    now?: number;
    scopeUserId?: string | null;
    onTelemetry?: (t: CloudPullTelemetry) => void;
  },
): Promise<{ ran: false; reason: CloudPullSkipReason } | { ran: true; result: T }> {
  ensureBroadcastSubscription();
  const now = opts?.now ?? Date.now();

  if (opts?.scopeUserId !== undefined && opts.scopeUserId !== scopeUserId) {
    setCloudPullWorkspace(opts.scopeUserId);
  }

  const decision = decideCloudPull(source, now);
  if (!decision.allowed) {
    opts?.onTelemetry?.(lastTelemetry!);
    return { ran: false, reason: decision.reason };
  }

  const isAuto = AUTO_SOURCES.has(source);
  const startedAt = now;
  const wallStart = Date.now();
  const telemetry: CloudPullTelemetry = {
    source,
    startedAt,
    endedAt: null,
    skipped: null,
    tableCounts: {},
    tableBytes: {},
    totalBytes: null,
    approxBytes: null,
    ok: null,
    tabId: getCloudPullTabId(),
    wasLeader: isAuto ? null : true,
    scopeUserId,
  };
  lastTelemetry = telemetry;

  const execute = async (): Promise<T> => {
    telemetry.wasLeader = true;
    if (scopeUserId) {
      broadcastCloudPull({
        type: "pull-start",
        userId: scopeUserId,
        tabId: getCloudPullTabId(),
        source,
        at: startedAt,
      });
    }
    logDev("start", {
      source,
      tabId: telemetry.tabId,
      scopeUserId,
      wasLeader: true,
      at: new Date(startedAt).toISOString(),
    });
    return run();
  };

  const promise = (async () => {
    if (!isAuto) {
      return execute();
    }
    if (!scopeUserId) {
      // Bez scope — lokalnie (testy / edge); nadal single-flight.
      return execute();
    }
    const lock = await tryAcquireAutoPullLeadership(scopeUserId, execute);
    if (!lock.acquired) {
      telemetry.wasLeader = false;
      telemetry.skipped = "cross-tab";
      telemetry.endedAt = Date.now();
      lastTelemetry = { ...telemetry };
      logDev("skipped", { source, reason: "cross-tab", tabId: telemetry.tabId });
      opts?.onTelemetry?.(lastTelemetry);
      throw new CrossTabSkipError();
    }
    return lock.result;
  })();

  inFlight = { source, promise };

  try {
    const result = await promise;
    // Logical clock: respektuje opts.now w testach; wall clock w produkcji.
    const endedAt = startedAt + Math.max(0, Date.now() - wallStart);
    telemetry.endedAt = endedAt;
    telemetry.ok = true;
    telemetry.totalBytes = sumBytes(telemetry.tableBytes);
    telemetry.approxBytes = telemetry.totalBytes;
    lastSuccessfulSnapshotAt = endedAt;
    realtimeNeedsCatchUp = false;
    lastTelemetry = { ...telemetry };
    if (scopeUserId) {
      broadcastCloudPull({
        type: "pull-end",
        userId: scopeUserId,
        tabId: getCloudPullTabId(),
        source,
        ok: true,
        at: endedAt,
        successfulSnapshotAt: endedAt,
      });
    }
    logDev("done", {
      source,
      tabId: telemetry.tabId,
      wasLeader: telemetry.wasLeader,
      durationMs: endedAt - startedAt,
      tableCounts: telemetry.tableCounts,
      tableBytes: telemetry.tableBytes,
      totalBytes: telemetry.totalBytes,
    });
    opts?.onTelemetry?.(lastTelemetry);
    return { ran: true, result };
  } catch (err) {
    if (err instanceof CrossTabSkipError) {
      return { ran: false, reason: "cross-tab" };
    }
    const endedAt = startedAt + Math.max(0, Date.now() - wallStart);
    telemetry.endedAt = endedAt;
    telemetry.ok = false;
    telemetry.totalBytes = sumBytes(telemetry.tableBytes);
    telemetry.approxBytes = telemetry.totalBytes;
    lastTelemetry = { ...telemetry };
    if (scopeUserId) {
      broadcastCloudPull({
        type: "pull-end",
        userId: scopeUserId,
        tabId: getCloudPullTabId(),
        source,
        ok: false,
        at: endedAt,
      });
    }
    logDev("failed", {
      source,
      tabId: telemetry.tabId,
      durationMs: endedAt - startedAt,
      err: err instanceof Error ? err.message : String(err),
    });
    opts?.onTelemetry?.(lastTelemetry);
    throw err;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}

class CrossTabSkipError extends Error {
  constructor() {
    super("cross-tab");
    this.name = "CrossTabSkipError";
  }
}

function sumBytes(map: Record<string, number>): number {
  let n = 0;
  for (const v of Object.values(map)) n += v;
  return n;
}

/** Pomiar rozmiaru JSON — preferuj Blob.size jak w wymaganiach. */
export function measureJsonBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value ?? null);
    if (typeof Blob !== "undefined") {
      return new Blob([json]).size;
    }
    return new TextEncoder().encode(json).length;
  } catch {
    return 0;
  }
}

/** @deprecated alias — używaj measureJsonBytes */
export function estimateJsonBytes(value: unknown): number {
  return measureJsonBytes(value);
}

export function recordCloudPullTableCount(
  table: string,
  count: number,
  approxBytes?: number,
): void {
  if (!lastTelemetry || lastTelemetry.skipped || lastTelemetry.endedAt != null) return;
  lastTelemetry.tableCounts[table] = (lastTelemetry.tableCounts[table] ?? 0) + count;
  if (typeof approxBytes === "number" && approxBytes >= 0) {
    lastTelemetry.tableBytes[table] = (lastTelemetry.tableBytes[table] ?? 0) + approxBytes;
    lastTelemetry.totalBytes = sumBytes(lastTelemetry.tableBytes);
    lastTelemetry.approxBytes = lastTelemetry.totalBytes;
  }
}

/** Zapis telemetrii z surowych danych odpowiedzi (count + Blob size). */
export function recordCloudPullTableData(table: string, data: unknown): void {
  const rows = Array.isArray(data) ? data.length : data == null ? 0 : 1;
  recordCloudPullTableCount(table, rows, measureJsonBytes(data));
}
