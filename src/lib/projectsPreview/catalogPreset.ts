import type { SupervisionCatalogPreset } from "./types";

function cat(
  id: string,
  title: string,
  sortOrder: number,
  activities: string[],
): SupervisionCatalogPreset["categories"][number] {
  const cleaned = activities
    .map((a) => a.trim())
    .filter((a) => a && !/^[-–—]+$/.test(a));
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const a of cleaned) {
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(a);
  }
  if (!uniq.some((a) => a === "Inny")) uniq.push("Inny");
  return { id, title, sortOrder, activities: uniq };
}

/**
 * Preset „Nadzór budowy - podstawowy”.
 * Kategorie zgodne ze specyfikacją preview; czynności typowe dla kontroli
 * kierownika / inwestora (lista demonstracyjna — do korekty po ocenie UX).
 */
export function buildNadzorPodstawowyPreset(): SupervisionCatalogPreset {
  return {
    id: "nadzor-podstawowy",
    name: "Nadzór budowy - podstawowy",
    categories: [
      cat("wpisy-wstepne", "1. Wpisy wstępne", 1, [
        "Przekazanie placu budowy",
        "Protokół przekazania terenu",
        "Tablica informacyjna budowy",
        "Ogrodzenie i zabezpieczenie terenu",
        "Zaplecze budowy (kontenery, WC)",
        "Inny",
      ]),
      cat("stan-zero", "2. Stan zero", 2, [
        "Wytyczenie budynku",
        "Wykopy fundamentowe",
        "Zbrojenie fundamentów",
        "Betonowanie fundamentów",
        "Izolacje poziome fundamentów",
        "Zasypki i zagęszczenie",
        "Drenaż / odwodnienie",
        "Inny",
      ]),
      cat("stan-surowy-otwarty", "3. Stan surowy otwarty", 3, [
        "Ściany fundamentowe / piwniczne",
        "Strop nad piwnicą / parterem",
        "Ściany konstrukcyjne kondygnacji",
        "Słupy i wieńce",
        "Klatka schodowa (konstrukcja)",
        "Kominy / szyby instalacyjne",
        "Inny",
      ]),
      cat("stan-surowy-zamkniety", "4. Stan surowy zamknięty", 4, [
        "Konstrukcja dachu",
        "Pokrycie dachu",
        "Obróbki blacharskie",
        "Okna i drzwi zewnętrzne",
        "Ocieplenie dachu / stropodachu",
        "Inny",
      ]),
      cat("instalacje", "5. Instalacje, sieci i przyłącza", 5, [
        "Instalacja wodociągowa",
        "Instalacja kanalizacyjna",
        "Instalacja CO / ciepło",
        "Instalacja elektryczna",
        "Instalacja teletechniczna",
        "Wentylacja / rekuperacja",
        "Przyłącze wody",
        "Przyłącze kanalizacji",
        "Przyłącze energii",
        "Inny",
      ]),
      cat("deweloperski-wew", "6. Stan deweloperski wewnętrzny", 6, [
        "Tynki wewnętrzne",
        "Wylewki / posadzki",
        "Glazura / terakota",
        "Sucha zabudowa",
        "Malowanie",
        "Stolarka wewnętrzna",
        "Balustrady wewnętrzne",
        "Inny",
      ]),
      cat("deweloperski-zew", "7. Stan deweloperski zewnętrzny", 7, [
        "Ocieplenie ścian zewnętrznych",
        "Tynk / elewacja",
        "Balkony / tarasy",
        "Obróbki i parapety",
        "Odprowadzenie wód opadowych",
        "Zagospodarowanie terenu",
        "Inny",
      ]),
      cat("kontrole", "8. Kontrole, wizyty i odbiory", 8, [
        "Kontrola PINB / organ nadzoru",
        "Wizyta inwestora",
        "Odbiór częściowy robót",
        "Odbiór instalacji",
        "Odbiór końcowy",
        "Usunięcie usterek pogwarancyjnych",
        "Inny",
      ]),
    ],
  };
}

/** Strip technical separators and identical duplicates (for imported lists). */
export function sanitizeActivityList(lines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const t = raw.trim();
    if (!t || /^[-–—]+$/.test(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
