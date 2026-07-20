import {
  Archive,
  FolderOpen,
  Gavel,
  List,
  MessageSquare,
  Search,
  StickyNote,
  User,
  Users,
  type LucideIcon,
} from "lucide-react";

export type HubTab = "chat" | "decisions" | "notes" | "media" | "search";
export type MediaSubTab = "media" | "files" | "links";
export type ChatBrowseTab = "all" | "favorites" | "people" | "channels" | "archive";
export type RailBrowseId = "all" | "people" | "channels" | "archive";

export type RailTreeItem =
  | { kind: "browse"; id: RailBrowseId; label: string; icon: LucideIcon; title: string }
  | { kind: "tab"; id: Exclude<HubTab, "chat">; label: string; icon: LucideIcon };

export const RAIL: { id: HubTab; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Czat", icon: MessageSquare },
  { id: "decisions", label: "Decyzje", icon: Gavel },
  { id: "notes", label: "Notatki", icon: StickyNote },
  { id: "media", label: "Media", icon: FolderOpen },
  { id: "search", label: "Wyszukaj", icon: Search },
];

export const RAIL_CHAT = RAIL[0]!;

/** Mini-tabulator pod Czat: ALL → Osoby/Kanały → sekcje hubu → Archiwum. */
export const RAIL_TREE: RailTreeItem[] = [
  {
    kind: "browse",
    id: "all",
    label: "ALL",
    icon: List,
    title: "Wszystkie rozmowy — kolejność ostatnich wiadomości",
  },
  {
    kind: "browse",
    id: "people",
    label: "Osoby",
    icon: User,
    title: "Rozmowy prywatne (DM)",
  },
  {
    kind: "browse",
    id: "channels",
    label: "Kanały",
    icon: Users,
    title: "Kanały i grupy firmowe",
  },
  { kind: "tab", id: "decisions", label: "Decyzje", icon: Gavel },
  { kind: "tab", id: "notes", label: "Notatki", icon: StickyNote },
  { kind: "tab", id: "media", label: "Media", icon: FolderOpen },
  { kind: "tab", id: "search", label: "Wyszukaj", icon: Search },
  {
    kind: "browse",
    id: "archive",
    label: "Archiwum",
    icon: Archive,
    title: "Zarchiwizowane rozmowy — widoczne tylko tutaj",
  },
];

/** Tryb mini-paska na mobile (bez favorites — folderów nie przenosimy). */
export type MobileHubMode =
  | { kind: "browse"; id: RailBrowseId }
  | { kind: "tab"; id: Exclude<HubTab, "chat"> };

export function mobileHubModeKey(mode: MobileHubMode): string {
  return mode.kind === "browse" ? `browse:${mode.id}` : `tab:${mode.id}`;
}

export function isMobileHubModeActive(mode: MobileHubMode, item: RailTreeItem): boolean {
  if (item.kind === "browse") {
    return mode.kind === "browse" && mode.id === item.id;
  }
  return mode.kind === "tab" && mode.id === item.id;
}
