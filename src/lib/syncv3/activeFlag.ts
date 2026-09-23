let v3Active = false;

export function setSyncV3ActiveFlag(active: boolean) {
  v3Active = active;
}

export function isSyncV3ActiveCached(): boolean {
  return v3Active;
}
