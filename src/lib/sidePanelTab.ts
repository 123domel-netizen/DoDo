/** Zakładka prawego panelu (desktop TodoPanel). */
export type SidePanelTab = "tasks" | "events" | "today";

let pending: SidePanelTab | null = null;

export function requestSidePanelTab(tab: SidePanelTab): void {
  pending = tab;
}

export function consumeSidePanelTab(): SidePanelTab | null {
  const tab = pending;
  pending = null;
  return tab;
}
