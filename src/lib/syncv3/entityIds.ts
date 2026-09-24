/** Stabilne klucze encji Sync v3 (bez kolizji UUID między typami). */
export function tagAssignmentEntityId(itemId: string): string {
  return `ta:${itemId}`;
}

export function parseTagAssignmentItemId(entityId: string): string {
  return entityId.startsWith("ta:") ? entityId.slice(3) : entityId;
}
