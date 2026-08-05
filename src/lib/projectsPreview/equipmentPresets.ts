/** Preset keys for heavy equipment on crew attendance declarations. */
export const EQUIPMENT_PRESET_KEYS = [
  "koparka",
  "dzwig",
  "ladowarka",
  "wywrotka",
  "walec",
  "other",
] as const;

export type EquipmentPresetKey = (typeof EQUIPMENT_PRESET_KEYS)[number];

export const EQUIPMENT_PRESET_LABEL: Record<EquipmentPresetKey, string> = {
  koparka: "Koparka",
  dzwig: "Dźwig",
  ladowarka: "Ładowarka",
  wywrotka: "Wywrotka",
  walec: "Walec",
  other: "Inny",
};

export function isEquipmentPresetKey(value: string): value is EquipmentPresetKey {
  return (EQUIPMENT_PRESET_KEYS as readonly string[]).includes(value);
}

export function equipmentDisplayLabel(
  key: string,
  label: string,
): string {
  if (key === "other") return label.trim() || "Inny";
  if (isEquipmentPresetKey(key)) return EQUIPMENT_PRESET_LABEL[key];
  return label.trim() || key;
}
