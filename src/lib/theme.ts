import type { ThemePreference } from "@/types";

const THEME_CACHE_KEY = "dodo-theme";
const THEME_PREF_KEY = "dodo-theme-pref";
const THEME_COLORS = { light: "#f0eff5", dark: "#100e16" } as const;

export function resolveTheme(pref: ThemePreference): "light" | "dark" {
  if (pref === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return pref;
}

export function applyTheme(pref: ThemePreference) {
  const resolved = resolveTheme(pref);
  const root = document.documentElement;

  root.classList.remove("dark");
  if (resolved === "dark") root.classList.add("dark");

  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;

  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[resolved]);

  try {
    localStorage.setItem(THEME_CACHE_KEY, resolved);
    localStorage.setItem(THEME_PREF_KEY, pref);
  } catch {
    /* private mode */
  }
}

/** Synchronous bootstrap before React — reads cached preference. */
export function initThemeEarly() {
  try {
    const pref = localStorage.getItem(THEME_PREF_KEY) as ThemePreference | null;
    if (pref === "light" || pref === "dark" || pref === "system") {
      applyTheme(pref);
      return;
    }
    const cached = localStorage.getItem(THEME_CACHE_KEY);
    if (cached === "light") applyTheme("light");
    else applyTheme("dark");
  } catch {
    applyTheme("dark");
  }
}

let systemListener: (() => void) | null = null;

export function watchSystemTheme(pref: ThemePreference, onChange: (pref: ThemePreference) => void) {
  if (systemListener) {
    window.matchMedia("(prefers-color-scheme: dark)").removeEventListener("change", systemListener);
    systemListener = null;
  }
  if (pref !== "system") return;

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  systemListener = () => {
    applyTheme("system");
    onChange("system");
  };
  mq.addEventListener("change", systemListener);
}
