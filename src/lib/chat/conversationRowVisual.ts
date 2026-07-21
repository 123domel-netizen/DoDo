/** Rozmiary awatara: mniejszy gdy odczytane, większy przy nieprzeczytanych. */
export function conversationRowAvatarLayout(showUnread: boolean, compact = false) {
  if (compact) {
    return showUnread
      ? ({ shell: "h-6 w-6", person: 22, icon: 12, fallback: 11 } as const)
      : ({ shell: "h-5 w-5", person: 18, icon: 10, fallback: 10 } as const);
  }
  return showUnread
    ? ({ shell: "h-8 w-8", person: 30, icon: 16, fallback: 15 } as const)
    : ({ shell: "h-6 w-6", person: 22, icon: 12, fallback: 12 } as const);
}
