/** Katalog robót Budowy: kategoria → główne elementy (zakresy). */

export interface ScheduleCatalogCategory {
  id: string;
  title: string;
  sortOrder: number;
  /** Proponowane główne elementy; użytkownik może też wpisać własny. */
  scopes: string[];
}

export interface ScheduleCatalogPreset {
  id: string;
  name: string;
  categories: ScheduleCatalogCategory[];
}

function cat(
  id: string,
  title: string,
  sortOrder: number,
  scopes: string[],
): ScheduleCatalogCategory {
  const cleaned = scopes.map((s) => s.trim()).filter(Boolean);
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const s of cleaned) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(s);
  }
  if (!uniq.some((s) => s === "Inny")) uniq.push("Inny");
  return { id, title, sortOrder, scopes: uniq };
}

export function buildBudowaScheduleCatalog(): ScheduleCatalogPreset {
  return {
    id: "budowa-zakresy-v1",
    name: "Budowa — kategorie i główne elementy",
    categories: [
      cat('stan-0', 'Stan "0"', 1, [
        "Przygotowanie: Zaplecze budowy",
        "Przygotowanie: Ogrodzenie budowy",
        "Przygotowanie: Śmieci i prace rozbiórkowe",
        "Przygotowanie: Zebranie humusu, przygotowanie gruntu, prace wykopowe",
        "Fundamenty: Zbroj. fundam.",
        "Fundamenty: Szalunki i betonowanie",
        "Fundamenty: Murowanie s.fundam",
        "Zasypki i chudziak: Hydroizolacje",
        "Zasypki i chudziak: Zasypanie",
        "Zasypki i chudziak: Chudy beton pod posadzkowy",
        "Zasypki i chudziak: Płyta fundamentowa",
        "Inny",
      ]),
      cat("stan-surowy-otwarty", "Stan surowy otwarty", 2, [
        "Murowanie - Ściany nośne",
        "Murowanie - Ściany działowe",
        "Mury - Żelbety",
        "Stropy",
        "Balkony",
        "Schody",
        "Kominy",
        "Inny",
      ]),
      cat("stan-surowy-zamkniety", "Stan surowy zamknięty", 3, [
        "Konstrukcja dachu",
        "Pokrycie dachu",
        "Rynny i rury spustowe",
        "Obróbki blacharskie",
        "Kominy",
        "Stolarka: Okna i drzwi",
        "Stolarka: Drzwi lokalowe i wewnętrzne",
        "Stolarka: Drzwi zewnętrzne",
        "Stolarka: Bramy",
        "Inny",
      ]),
      cat("instalacje", "Instalacje, sieci i przyłącza", 4, [
        "Instalacje elektryczne",
        "Instalacje sanitarne",
        "Sieci i przyłącza: Elektryczne",
        "Sieci i przyłącza: Wodne",
        "Sieci i przyłącza: Kanalizacyjne",
        "Inny",
      ]),
      cat("deweloperski-wew", "Stan deweloperski wewnętrzny", 5, [
        "Posadzki termoizolacja: Robocizna",
        "Posadzki termoizolacja",
        "Posadzki wylewka",
        "Posadzki: Płytki i wykończenie cz. wspólnych",
        "Ściany tynki",
        "Ściany -Wykończenie cz. wspólnych",
        "Termoizolacja sufitów",
        "Sufity GK lub tynki",
        "Balustrady",
        "Montaż elementów wspólnych",
        "Inny",
      ]),
      cat("deweloperski-zew", "Stan deweloperski zewnętrzny", 6, [
        "Termoizolacja ścian",
        "Dekoracje ścian",
        "Parapety zewnętrzne",
        "Elementy wykończenia dachu: podbitki, obróbki wykończeniowe, daszki itp.",
        "Wykończenie balkonów",
        "Cokoły i opaski przy fundamentach",
        "Utwardzenia parkingów i dróg",
        "Elementy architektury wspólnej (tarasy, obudowy, plac zabaw itp.)",
        "Ogrodzenia",
        "Tereny zielone",
        "Inny",
      ]),
      cat("stan-pod-klucz", "Stan pod klucz", 7, ["Wykończenie", "Inny"]),
      cat("reklamacja", "Reklamacja", 8, ["Reklamacja", "Inny"]),
    ],
  };
}
