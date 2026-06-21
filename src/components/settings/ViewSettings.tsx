import { useStore } from "@/state/store";

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(v, max));
}

/** Kontrolki zakresu godzin i wysokości siatki — współdzielone przez Toolbar i widok mobilny. */
export function ViewSettings() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);

  return (
    <>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Zakres widocznych godzin
      </div>
      <div className="flex items-center gap-2 text-sm text-ink-light">
        <label className="flex items-center gap-1">
          od
          <input
            type="number"
            min={0}
            max={settings.dayEndHour - 1}
            value={settings.dayStartHour}
            onChange={(e) =>
              setSettings({
                dayStartHour: clamp(+e.target.value, 0, settings.dayEndHour - 1),
              })
            }
            className="w-16 rounded-lg border border-line bg-surface-raised px-2 py-1 text-ink"
          />
        </label>
        <label className="flex items-center gap-1">
          do
          <input
            type="number"
            min={settings.dayStartHour + 1}
            max={24}
            value={settings.dayEndHour}
            onChange={(e) =>
              setSettings({
                dayEndHour: clamp(+e.target.value, settings.dayStartHour + 1, 24),
              })
            }
            className="w-16 rounded-lg border border-line bg-surface-raised px-2 py-1 text-ink"
          />
        </label>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-ink-faint">
        Wydarzenia spoza tego zakresu pojawią się jako „chmurki” nad i pod siatką, bez
        marnowania miejsca na puste godziny.
      </p>

      <div className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        Wysokość godziny
      </div>
      <input
        type="range"
        min={36}
        max={96}
        value={settings.hourHeight}
        onChange={(e) => setSettings({ hourHeight: +e.target.value })}
        className="w-full"
      />
    </>
  );
}
