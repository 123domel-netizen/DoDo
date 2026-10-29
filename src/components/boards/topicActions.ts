import { useCallback } from "react";
import { useBoardsStore } from "@/lib/boards/store";
import type { TopicPatch } from "@/lib/boards/api";
import type { BoardTopic } from "@/lib/boards/types";

/** Akcje na temacie (przypnij, odłóż, zamknij…) — błędy trafiają do bannera Tablic. */
export function useTopicActions(topic: BoardTopic) {
  const updateTopic = useBoardsStore((s) => s.updateTopic);
  const setNotice = useBoardsStore((s) => s.setNotice);

  const apply = useCallback(
    async (patch: TopicPatch) => {
      const res = await updateTopic(topic.id, patch);
      if (res.error) setNotice(res.error);
      return !res.error;
    },
    [updateTopic, setNotice, topic.id],
  );

  return {
    togglePin: () => apply({ pinned_at: topic.pinnedAt ? null : new Date().toISOString() }),
    snoozeUntil: (until: Date) => apply({ snoozed_until: until.toISOString() }),
    wake: () => apply({ snoozed_until: null }),
    close: () => apply({ closed_at: new Date().toISOString() }),
    reopen: () => apply({ closed_at: null }),
    rename: (title: string) => apply({ title }),
    setCode: (code: string | null) => apply({ code }),
    setDescription: (description: string) => apply({ description }),
  };
}
