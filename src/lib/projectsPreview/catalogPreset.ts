import type { SupervisionCatalogPreset } from "./types";

function cat(
  id: string,
  title: string,
  sortOrder: number,
  activities: string[],
): SupervisionCatalogPreset["categories"][number] {
  const cleaned = sanitizeActivityList(activities);
  if (!cleaned.some((a) => a === "Inny")) cleaned.push("Inny");
  return { id, title, sortOrder, activities: cleaned };
}

/** Strip technical separators and identical duplicates (case-insensitive). */
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

/**
 * Preset „Nadzór budowy - podstawowy” — lista czynności od użytkownika
 * (separatory „- / -- / ---” usunięte, identyczne duplikaty pominięte).
 */
export function buildNadzorPodstawowyPreset(): SupervisionCatalogPreset {
  return {
    id: "nadzor-podstawowy",
    name: "Nadzór budowy - podstawowy",
    categories: [
      cat("wpisy-wstepne", "1. Wpisy wstępne", 1, [
        "Objąłem funkcję kierownika budowy dla przedmiotowej inwestycji.",
        "Pobrano projekt budowlany oraz projekt techniczny. Nakazano wykonanie zabezpieczenia i wygrodzenia terenu budowy. Umieszczono tablice informacyjne zgodnie z przepisami. Poinformowano o bezwzględnym obowiązku przestrzegania zasad BHP.",
        "Przejąłem obowiązki kierownika budowy. Pobrano projekt budowlany oraz projekt techniczny. Przypominam o zabezpieczeniu i zamykaniu terenu budowy, a także informuję o bezwzględnym obowiązku przestrzegania zasad BHP.",
        "Zlecono geodecie wytyczenie obiektu.",
        "Inny",
      ]),
      cat("stan-0", "2. Stan zero", 2, [
        "Zdjęto warstwę humusu w zakresie przewidzianym w inwestycji.",
        "Rozpoczęto wykopy pod fundamenty",
        "Wykonano podbudowę pod fundamenty",
        "Rozpoczęto szalowanie fundamentów",
        "Zakończono zbrojenie fundamentów.",
        "Ułożono beton w fundamentach.",
        "Rozpoczęto prace murarskie ścian fundamentowych",
        "Zakończono murowanie ścian fundamentowych.",
        "Wykonano zasypki między fundamentowe, zagęszczono i przygotowano do układania podbudowy betonowej",
        'Wykonano warstwę chudego betonu stanu "0"',
        "Inny",
      ]),
      cat("stan-surowy-otwarty", "3. Stan surowy otwarty", 3, [
        "Rozpoczęto prace murarskie ścian nadziemia",
        "Wykonano szalunki i zbrojenie elementów żelbetowych nadziemia",
        "Zakończono murowanie ścian nośnych parteru",
        "Zakończono murowanie ścian nośnych",
        "Rozpoczęto wykonanie stropów",
        "Wykonano szalowanie i zbrojenie stropów",
        "Wykonano betonowanie stropów",
        "Ułożono stropy prefabrykowane",
        "Wykonano zbrojenie szalowanie i zbrojenie przestrzeni między stropowych",
        "Wykonano betonowanie przestrzeni między stropowych",
        "Wykonano szalunki i zbrojenie schodów",
        "Wykonano betonowanie schodów",
        "Wykonano schody",
        "Zakończono murowanie kominów",
        "Wykonano szalunki i zbrojenie",
        "Ułożono beton",
        "Inny",
      ]),
      cat("stan-surowy-zamkniety", "4. Stan surowy zamknięty", 4, [
        "Wykonano montaż murłaty",
        "Rozpoczęto montaż konstrukcji dachu",
        "Zakończono montaż konstrukcji dachu",
        "Przygotowano konstrukcje do montażu pokrycia dachowego",
        "Wykonano pokrycie dachowe",
        "Wykonano rynny i obróbki blacharskie",
        "Zamontowano stolarkę okienną",
        "Zamontowano drzwi zewnętrzne",
        "Zamontowano bramę garażową",
        "Inny",
      ]),
      cat("instalacje", "5. Instalacje, sieci i przyłącza", 5, [
        "Wykonano instalację podejść wod-kan pod budynkiem",
        "Wykonano montaż wewnętrznej instalacji sanitarnej ok. 90%",
        "Wykonano montaż wewnętrznej instalacji elektrycznej ok. 90%",
        "Wykonano instalację elektryczną",
        "Wykonano instalację sanitarną",
        "Wykonano przyłącze elektryczne",
        "Wykonano przyłącze wodociągowe",
        "Wykonano przyłącze kanalizacji sanitarnej",
        "Wykonano przyłącze kanalizacji deszczowej",
        "Wykonano przyłącze gazu",
        "Wykonano przyłącze ciepłociągu",
        "Wykonano montaż urządzeń grzewczych wraz z osprzętem",
        "Inny",
      ]),
      cat("deweloperski-wew", "6. Stan deweloperski wewnętrzny", 6, [
        "Wykonano tynki wewnętrzne",
        "Wykonano termoizolację dachu",
        "Wykonano sufity w systemie gips-karton na stelażu",
        "Wykonano posadzki",
        "Zagruntowano i pomalowano",
        "Zamontowano balustrady klatki schodowej",
        "Zamontowano balustrady",
        "Inny",
      ]),
      cat("deweloperski-zew", "7. Stan deweloperski zewnętrzny", 7, [
        "Wykonano termoizolację ścian zewnętrznych",
        "Wykonano siatkowanie i wyprawę klejową na elewacji",
        "Zakończono prace elewacyjne",
        "Wykonano cokoły i opaski przy fundamentach",
        "Wykonano utwardzenia zewnętrzne",
        "Wykonano zjazd do inwestycji",
        "Zamontowano elementy architektury wspólnej",
        "Wykonano ogrodzenie",
        "Zagospodarowano tereny zielone",
        "Inny",
      ]),
      cat("kontrole", "8. Kontrole, wizyty i odbiory", 8, [
        "Warunki atmosferyczne niesprzyjające do prowadzenia prac!",
        "Wizyta na budowie",
        "Wizyta Służb i organów zewnętrznych",
        "Wykonano próby i badania",
        "Przygotowano dokumentację powykonawczą",
        "Zakończono prace budowlane, teren uprzątnięty i stosownie zagospodarowany. Budynek zgłaszam do odbioru / nadaje się do użytkowania",
        "Wstrzymuję prace!",
        "Inny",
      ]),
    ],
  };
}
