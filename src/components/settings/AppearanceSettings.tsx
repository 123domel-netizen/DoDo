import { useStore } from "@/state/store";
import { applyTheme } from "@/lib/theme";
import type { ThemePreference } from "@/types";

const OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: "light", label: "Jasny" },
  { id: "dark", label: "Ciemny" },
  { id: "system", label: "Systemowy" },
];

export function AppearanceSettings() {
  const theme = useStore((s) => s.settings.theme);
  const setSettings = useStore((s) => s.setSettings);

  const pick = (next: ThemePreference) => {
    setSettings({ theme: next });
    applyTheme(next);
  };

  return (
    <>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Motyw
      </div>
      <div className="flex gap-1 rounded-lg border border-line bg-surface-raised p-0.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => pick(opt.id)}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
              theme === opt.id
                ? "bg-accent text-white shadow-glow"
                : "text-ink-light hover:text-ink"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-ink-faint">
        Systemowy dopasowuje się do ustawień urządzenia. Domyślnie aplikacja startuje w trybie
        ciemnym.
      </p>
    </>
  );
}
