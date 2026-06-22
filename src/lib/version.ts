/** Wersja aplikacji (z package.json) — do diagnostyki multi-device. */
export const APP_VERSION = "0.1.0";

/** Identyfikator buildu (dev vs prod). */
export const BUILD_LABEL = import.meta.env.PROD ? "production" : "development";
