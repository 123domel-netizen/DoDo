/** Stałe odświeżania overview / obecności — bez side-effectów importu. */

/** Awaryjny reconciliation overview (widoczna karta). */
export const CHAT_RECONCILE_INTERVAL_MS = 5 * 60_000;

/** Debounce refetch overview po serii eventów Realtime. */
export const CHAT_OVERVIEW_REALTIME_DEBOUNCE_MS = 3_000;

/** Po powrocie do widocznej karty — refetch tylko gdy starsze. */
export const CHAT_OVERVIEW_STALE_MS = 5 * 60_000;

/** Długa przerwa Realtime czatu → catch-up overview. */
export const CHAT_REALTIME_CATCHUP_MS = 5 * 60_000;
