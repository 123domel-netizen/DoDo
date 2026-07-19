import { useEffect, useMemo, useState } from "react";
import { cloudEnabled } from "@/lib/supabase";
import { useStore } from "@/state/store";
import { useChatStore } from "@/lib/chat/store";
import { sortOverview } from "@/lib/chat/feed";
import {
  fetchAttachmentsForConversations,
  fetchDecisionsForConversations,
  fetchNotesForConversations,
  fetchPublicChannels,
  type ConversationAttachment,
} from "@/lib/chat/api";
import type {
  ChatDecision,
  ChatNote,
  ChatOverviewEntry,
  PublicChannelInfo,
} from "@/lib/chat/types";
import type { HubTab, MediaSubTab, RailBrowseId } from "@/components/hub/hubRail";

/**
 * Wspólne ładowanie list hubu (decyzje / notatki / media / kanały publiczne)
 * oraz zestawy browse ALL / Osoby / Kanały.
 */
export function useHubRegistryLists(opts: {
  /** Aktywna sekcja — fetch tylko gdy potrzeba. */
  hubTab: HubTab | "chat";
  /** Dla browse — używane tylko do sortowania list (zawsze z overview). */
  enabled?: boolean;
}) {
  const { hubTab, enabled = true } = opts;
  const overview = useChatStore((s) => s.overview);
  const registryEpoch = useChatStore((s) => s.registryEpoch);
  const items = useStore((s) => s.items);
  const groups = useStore((s) => s.groups);
  const tags = useStore((s) => s.tags);

  const [publicChannels, setPublicChannels] = useState<PublicChannelInfo[]>([]);
  const [decisions, setDecisions] = useState<ChatDecision[] | null>(null);
  const [notes, setNotes] = useState<ChatNote[] | null>(null);
  const [media, setMedia] = useState<(ConversationAttachment & { conversationId: string })[] | null>(
    null,
  );
  const [mediaSubTab, setMediaSubTab] = useState<MediaSubTab>("media");
  const [hubTagFilter, setHubTagFilter] = useState<string | null>(null);

  const sorted = useMemo(() => sortOverview(overview), [overview]);
  const allByRecent = useMemo(
    () =>
      [...overview].sort((a, b) =>
        (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt),
      ),
    [overview],
  );
  const people = useMemo(() => sorted.filter((c) => c.kind === "dm"), [sorted]);
  const channels = useMemo(() => sorted.filter((c) => c.kind === "channel"), [sorted]);
  const joinedIds = useMemo(() => new Set(overview.map((c) => c.id)), [overview]);
  const discoverable = useMemo(
    () => publicChannels.filter((c) => !joinedIds.has(c.id)),
    [publicChannels, joinedIds],
  );

  const registryConvIds = useMemo(() => overview.map((c) => c.id), [overview]);
  const registryConvIdsKey = registryConvIds.join(",");
  const convIds = registryConvIds;
  const convIdsKey = registryConvIdsKey;

  const allUserTags = useMemo(
    () => Object.values(tags).sort((a, b) => a.name.localeCompare(b.name, "pl")),
    [tags],
  );

  useEffect(() => {
    if (!enabled || !cloudEnabled) return;
    void fetchPublicChannels().then(setPublicChannels);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || hubTab !== "decisions") return;
    let cancelled = false;
    setDecisions(null);
    void fetchDecisionsForConversations(registryConvIds).then((list) => {
      if (!cancelled) setDecisions(list);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, hubTab, registryConvIdsKey, registryEpoch]);

  useEffect(() => {
    if (!enabled || hubTab !== "notes") return;
    let cancelled = false;
    setNotes(null);
    void fetchNotesForConversations(registryConvIds).then((list) => {
      if (!cancelled) setNotes(list);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, hubTab, registryConvIdsKey, registryEpoch]);

  useEffect(() => {
    if (!enabled || hubTab !== "media") return;
    let cancelled = false;
    setMedia(null);
    void fetchAttachmentsForConversations(convIds).then((list) => {
      if (!cancelled) setMedia(list);
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, hubTab, convIdsKey]);

  const browseList = (id: RailBrowseId): ChatOverviewEntry[] => {
    if (id === "all") return allByRecent;
    if (id === "people") return people;
    return channels;
  };

  return {
    overview,
    items,
    groups,
    tags,
    allUserTags,
    allByRecent,
    people,
    channels,
    discoverable,
    browseList,
    decisions,
    notes,
    media,
    mediaSubTab,
    setMediaSubTab,
    hubTagFilter,
    setHubTagFilter,
  };
}
