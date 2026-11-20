/**
 * Koordynacja auto-pulla między kartami:
 * 1) navigator.locks (preferowane)
 * 2) localStorage lease (fallback)
 * 3) lokalny run (gdy wszystko padnie) — nigdy nie blokuje manualnego refreshu
 */

export type CloudPullBroadcastMessage =
  | {
      type: "pull-start";
      userId: string;
      tabId: string;
      source: string;
      at: number;
    }
  | {
      type: "pull-end";
      userId: string;
      tabId: string;
      source: string;
      ok: boolean;
      at: number;
      successfulSnapshotAt?: number;
    };

export type CrossTabLockResult<T> =
  | { acquired: true; result: T }
  | { acquired: false };

export const AUTO_PULL_LEASE_TTL_MS = 90_000;
export const AUTO_PULL_LEASE_RENEW_MS = 30_000;

type LockRequestFn = <T>(
  name: string,
  run: () => Promise<T>,
) => Promise<CrossTabLockResult<T>>;

type BroadcastFn = (msg: CloudPullBroadcastMessage) => void;

type LeaseRecord = {
  tabId: string;
  acquiredAt: number;
  expiresAt: number;
};

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

let tabId = createTabId();
let channel: BroadcastChannel | null = null;
let listeners = new Set<(msg: CloudPullBroadcastMessage) => void>();

let lockRequestOverride: LockRequestFn | null = null;
let broadcastOverride: BroadcastFn | null = null;
let locksAvailableOverride: boolean | null = null;
let storageOverride: StorageLike | null = null;
let nowOverride: (() => number) | null = null;

function createTabId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowMs(): number {
  return nowOverride ? nowOverride() : Date.now();
}

export function getCloudPullTabId(): string {
  return tabId;
}

export function resetCloudPullCrossTabForTests(nextTabId?: string): void {
  tabId = nextTabId ?? createTabId();
  lockRequestOverride = null;
  broadcastOverride = null;
  locksAvailableOverride = null;
  storageOverride = null;
  nowOverride = null;
  if (channel) {
    try {
      channel.close();
    } catch {
      /* ignore */
    }
    channel = null;
  }
  listeners.clear();
}

export function setCloudPullCrossTabTestHooks(hooks: {
  lockRequest?: LockRequestFn | null;
  broadcast?: BroadcastFn | null;
  locksAvailable?: boolean | null;
  storage?: StorageLike | null;
  now?: (() => number) | null;
}): void {
  if ("lockRequest" in hooks) lockRequestOverride = hooks.lockRequest ?? null;
  if ("broadcast" in hooks) broadcastOverride = hooks.broadcast ?? null;
  if ("locksAvailable" in hooks) locksAvailableOverride = hooks.locksAvailable ?? null;
  if ("storage" in hooks) storageOverride = hooks.storage ?? null;
  if ("now" in hooks) nowOverride = hooks.now ?? null;
}

function hasWebLocks(): boolean {
  if (locksAvailableOverride != null) return locksAvailableOverride;
  try {
    return typeof navigator !== "undefined" && Boolean(navigator.locks?.request);
  } catch {
    return false;
  }
}

function getStorage(): StorageLike | null {
  if (storageOverride) return storageOverride;
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function leaseKey(kind: string, userId: string): string {
  return `dodo-auto-pull-lease:${kind}:${userId}`;
}

function readLease(store: StorageLike, key: string): LeaseRecord | null {
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LeaseRecord;
    if (!parsed?.tabId || !parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLease(store: StorageLike, key: string, lease: LeaseRecord): void {
  store.setItem(key, JSON.stringify(lease));
}

/** Próba przejęcia / odnowienia lease. Zwraca true gdy ta karta jest właścicielem. */
export function tryAcquireStorageLease(
  kind: string,
  userId: string,
  ttlMs = AUTO_PULL_LEASE_TTL_MS,
): boolean {
  const store = getStorage();
  if (!store) return true; // brak storage → nie blokuj
  const key = leaseKey(kind, userId);
  const t = nowMs();
  try {
    const existing = readLease(store, key);
    if (existing && existing.expiresAt > t && existing.tabId !== tabId) {
      return false;
    }
    const lease: LeaseRecord = {
      tabId,
      acquiredAt: existing?.tabId === tabId ? existing.acquiredAt : t,
      expiresAt: t + ttlMs,
    };
    writeLease(store, key, lease);
    // Weryfikacja po zapisie (wyścig dwóch kart).
    const verify = readLease(store, key);
    return Boolean(verify && verify.tabId === tabId);
  } catch {
    return true;
  }
}

export function renewStorageLease(
  kind: string,
  userId: string,
  ttlMs = AUTO_PULL_LEASE_TTL_MS,
): void {
  const store = getStorage();
  if (!store) return;
  const key = leaseKey(kind, userId);
  const t = nowMs();
  try {
    const existing = readLease(store, key);
    if (!existing || existing.tabId !== tabId) return;
    writeLease(store, key, {
      ...existing,
      expiresAt: t + ttlMs,
    });
  } catch {
    /* ignore */
  }
}

export function releaseStorageLease(kind: string, userId: string): void {
  const store = getStorage();
  if (!store) return;
  const key = leaseKey(kind, userId);
  try {
    const existing = readLease(store, key);
    if (existing && existing.tabId !== tabId) return;
    store.removeItem(key);
  } catch {
    /* ignore */
  }
}

function ensureChannel(): BroadcastChannel | null {
  if (broadcastOverride) return null;
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel("dodo-cloud-pull-v1");
      channel.onmessage = (ev: MessageEvent) => {
        const data = ev.data as CloudPullBroadcastMessage;
        if (!data || typeof data !== "object" || !("type" in data)) return;
        for (const fn of listeners) fn(data);
      };
    } catch {
      channel = null;
    }
  }
  return channel;
}

export function subscribeCloudPullBroadcast(
  fn: (msg: CloudPullBroadcastMessage) => void,
): () => void {
  listeners.add(fn);
  ensureChannel();
  return () => {
    listeners.delete(fn);
  };
}

export function broadcastCloudPull(msg: CloudPullBroadcastMessage): void {
  try {
    if (broadcastOverride) {
      broadcastOverride(msg);
      return;
    }
    const ch = ensureChannel();
    if (!ch) return;
    ch.postMessage(msg);
  } catch {
    /* ignore */
  }
}

async function runWithStorageLease<T>(
  kind: string,
  userId: string,
  run: () => Promise<T>,
): Promise<CrossTabLockResult<T>> {
  if (!tryAcquireStorageLease(kind, userId)) {
    return { acquired: false };
  }
  const renewId = setInterval(() => {
    renewStorageLease(kind, userId);
  }, AUTO_PULL_LEASE_RENEW_MS);
  try {
    const result = await run();
    return { acquired: true, result };
  } finally {
    clearInterval(renewId);
    releaseStorageLease(kind, userId);
  }
}

/**
 * Leadership auto-pulla. Manual/auth nie powinny tego wołać.
 * Awaria locks/storage → lokalny run (nie blokuje sync).
 */
export async function tryAcquireAutoPullLeadership<T>(
  userId: string,
  run: () => Promise<T>,
  kind = "cloud-snapshot",
): Promise<CrossTabLockResult<T>> {
  const lockName = `dodo-cloud-auto-pull:${kind}:${userId}`;

  try {
    if (lockRequestOverride) {
      return await lockRequestOverride(lockName, run);
    }

    if (hasWebLocks()) {
      return await navigator.locks.request(
        lockName,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return { acquired: false as const };
          const result = await run();
          return { acquired: true as const, result };
        },
      );
    }

    return await runWithStorageLease(kind, userId, run);
  } catch {
    try {
      return { acquired: true, result: await run() };
    } catch (err) {
      throw err;
    }
  }
}
