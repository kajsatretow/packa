# Packa

En lokal-first PWA för att skapa packlistor utifrån resa, väder och egna regler.

Det här repositoryt innehåller **ingen personlig packdata och inga riktiga personnamn**. Appen startar med en tom regellista och en tom lista med personer — du bygger upp dina egna i appen, eller importerar en tidigare export.

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

## Data och integritet

- **Allt sparas lokalt.** Personer, regler, resor och avbockningar sparas bara i `localStorage` i din webbläsare, på den här enheten. Inget skickas till någon server eller molntjänst.
- **Repot innehåller inga användarspecifika personer eller regler.** Både personlistan och masterlistan är tomma vid första start — appen fungerar med noll av vardera och visar tydliga tomma lägen i Inställningar med instruktioner för att lägga till eller importera.
- **Exportera som säkerhetskopia.** Om du rensar webbläsardata eller webbplatsdata för sidan försvinner allt som inte exporterats. Använd knapparna i Inställningar för att exportera regler eller all data (personer + regler + resor) som en nedladdningsbar JSON-fil, och importera för att återställa eller flytta till en annan enhet. Import validerar filens struktur och skriver aldrig över befintlig data utan bekräftelse.
- **Uppgraderar du från en äldre version** med regler redan sparade i `localStorage`, används de precis som förut — appen skriver aldrig över eller seedar om från något paketerat standardinnehåll. Personlistan är dock ny: om dina regler redan har personnamn ifyllda men ingen person är konfigurerad än, visar Inställningar en tydlig varning om vilka namn som saknar konfiguration, i stället för att gissa vem som är ägare.
- **Väder och plats.** Plats och väder hämtas från [Open-Meteo](https://open-meteo.com/) vid generering av packlista. Endast det som krävs skickas: destinationstexten du skriver in (för platssökningen) samt de upplösta koordinaterna och resedatumen (för väderprognosen). Inga regler, resedata, personer, avbockningar eller andra personliga uppgifter skickas till Open-Meteo eller någon annan extern tjänst.

## Personer

Under Inställningar → Personer kan du lägga till de personer du packar för. Varje person har tre inställningar:

- **Ägare (du)** – exakt en person kan vara ägare. Ägarens saker filtreras aldrig efter reskamrat, eftersom ägaren implicit alltid reser med.
- **Kan äga packsaker** – om personen kan väljas i fältet "Person" på en regel.
- **Kan väljas som reskamrat** – om personen kan kryssas i som reskamrat på resformuläret (gäller inte ägaren, som aldrig behöver väljas).

Det går även att kryssa i "Annan vuxen" som reskamrat vid enstaka tillfällen, utan att behöva lägga till en permanent person för det.

## Regler

- Den färdiga packlistan grupperas efter fältet "Var", i ordningen: Garderoben, Byrån, Badrummet, Sovrummet, Köket, Hallen, och sist allt annat.
- `Person` avgör vem saken tillhör, valt bland de personer som är markerade som "Kan äga packsaker". Om personen inte är ägaren tas saken automatiskt bara med när den personen är vald som reskamrat på resan — du behöver inte skriva ett eget villkor för det.
- `When` kan användas för mer specifika villkor, t.ex. att en av dina egna saker bara ska med när en viss reskamrat är med: `traveler("Namn")`. Det fungerar oberoende av den automatiska filtreringen ovan.
- Väder kan bara hämtas när resan ligger inom prognoshorisonten. Packlistan genereras ändå, men väderberoende regler hoppas över om väderdata saknas.

## Regeluttryck

Exempel:

- `always`
- `nights > 2`
- `travel_hours > 3`
- `rainy`
- `min_day_temp < 10 OR (min_day_temp < 15 AND rainy)`
- `activity("gym")`
- `traveler("Namn")`
- `accommodation == "hotel"`
- `NOT linens_provided`
- `trip_has_weekday("Thursday")`

Quantity:

- `1`
- `nights + 1`
- `ceil(nights * 1.5)`

Uttrycken tolkas av en liten parser i appen; JavaScript `eval` används inte.
