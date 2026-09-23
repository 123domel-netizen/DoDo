/** Flagi procesu Sync v3 (bez I/O). */
let v3WritesEnabled = false;
let v3WorkerEnabled = false;
let migrationGateBlocked = false;

export function setSyncV3WriteFlags(opts: {
  writesEnabled: boolean;
  workerEnabled: boolean;
  migrationBlocked?: boolean;
}) {
  v3WritesEnabled = opts.writesEnabled;
  v3WorkerEnabled = opts.workerEnabled;
  if (opts.migrationBlocked !== undefined) {
    migrationGateBlocked = opts.migrationBlocked;
  }
}

/** Kompatybilność: „active” cache ≈ worker enabled (cutover). */
export function setSyncV3ActiveFlag(active: boolean) {
  v3WorkerEnabled = active;
  if (active) {
    v3WritesEnabled = true;
    migrationGateBlocked = false;
  }
}

export function isSyncV3ActiveCached(): boolean {
  return v3WorkerEnabled;
}

export function isSyncV3WritesEnabledCached(): boolean {
  return v3WritesEnabled;
}

export function isMigrationGateBlocked(): boolean {
  return migrationGateBlocked;
}

export function resetSyncV3Flags() {
  v3WritesEnabled = false;
  v3WorkerEnabled = false;
  migrationGateBlocked = false;
}
