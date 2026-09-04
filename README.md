# Packa

En lokal-first PWA för Kajsas packlistor. Reglerna är seedade från den normaliserade Excel-listan.

## Köra lokalt

PWA-funktioner kräver HTTP(S), så öppna inte bara `index.html` som en fil. I mappen:

```bash
python3 -m http.server 8080
```

Öppna sedan `http://localhost:8080`.

## Publicera

### GitHub Pages

1. Skapa ett nytt repository på GitHub, t.ex. `packa`.
2. Lägg filerna i den här mappen direkt i repositoryts rot och pusha till `main`.
3. På GitHub: **Settings → Pages**.
4. Under **Build and deployment**, välj **Deploy from a branch**, sedan `main` och `/ (root)`, och spara.
5. När GitHub visar Pages-adressen, öppna den på iPhone i Safari → **Dela → Lägg till på hemskärmen**.

Ingen backend behövs.

## Data

- Regler, resor och avbockningar sparas i `localStorage` på enheten.
- Den färdiga packlistan grupperas i ordningen: Garderoben, Byrån, Badrummet, Sovrummet, Isoldes rum, Köket, Hallen.
- Standardreglerna läses från `default-rules.json` första gången.
- Plats och väder hämtas från Open-Meteo vid generering. Temperaturregler använder bara varje dags prognostiserade maxtemperatur; nattens minimitemperatur tas inte med.
- Väder kan bara hämtas när resan ligger inom prognoshorisonten. Packlistan genereras ändå, men väderberoende regler hoppas över om väderdata saknas.

## Regeluttryck

Exempel:

- `always`
- `nights > 2`
- `travel_hours > 3`
- `rainy`
- `min_day_temp < 10 OR (min_day_temp < 15 AND rainy)`
- `activity("gym")`
- `traveler("Isolde")`
- `accommodation == "hotel"`
- `NOT linens_provided`
- `trip_has_weekday("Thursday")`

Quantity:

- `1`
- `nights + 1`
- `ceil(nights * 1.5)`

Uttrycken tolkas av en liten parser i appen; JavaScript `eval` används inte.
