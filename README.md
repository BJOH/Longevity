# Longevity

Personlig, mobilanpassad hälsotracker för ett långt liv. Checka av dagliga mål
och följ kurvor för **vikt, intermittent fasta, träning/steg och sömn** — helt
utan konto, server eller databas. All data sparas lokalt i webbläsaren.

## Funktioner

- **Idag** — dagens mål som checklista med progressring och streak-räknare
  (väg dig, fasta X h, träna X min, gå X steg, sov X h, ät enligt plan).
  Fastan beräknas automatiskt ur ätfönstret (första/sista måltid).
- **Trender** — kurvor med mållinjer för vikt, sömn, fasta, träning och steg
  över 7/30/90/365 dagar, med tooltip och direktetiketter. Mörkt läge stöds.
- **Historik** — tabell över alla loggade dagar.
- **Apple Hälsa** — tre vägar in, se [guiden](docs/apple-health.html):
  1. iOS-genväg som loggar sömn/steg/träning automatiskt varje morgon
     (via `#log?...`-URL:en).
  2. [Health Auto Export](https://apps.apple.com/app/id1115567069)-JSON.
  3. Hela historiken via Hälsa-appens `export.xml` (läses i bitar,
     klarar stora filer; sömnintervall slås ihop och steg dubbelräknas inte).
- **PWA** — lägg till på hemskärmen från Safari så öppnas den i helskärm och
  funkar offline (service worker + manifest).
- **Backup** — exportera/återställ all data som JSON under *Mer → Data*.

## Kom igång

Statisk sajt utan byggsteg — servera filerna över HTTPS, klart.

**GitHub Pages (enklast):** Settings → Pages → *Deploy from a branch* →
`main` / `/ (root)`. Sajten hamnar på `https://<användare>.github.io/Longevity/`.

**Lokalt:**

```bash
python3 -m http.server 8080
# öppna http://localhost:8080
```

> Obs: service workern (offline-stödet) kräver HTTPS eller localhost.

## Teknik

Vanilla JS (ES-moduler), handritade SVG-diagram, localStorage som datalager.
Inga beroenden, inget byggsteg.

```
index.html            appskal med fyra vyer
css/style.css         stilar, ljust + mörkt tema
js/store.js           datalager (localStorage), mål & streaks
js/charts.js          SVG-linje/stapeldiagram med tooltip
js/import.js          Apple Health-import (export.xml, Health Auto Export, #log-URL)
js/app.js             vyer och händelser
sw.js                 offline-cache
docs/apple-health.html  guide för Apple Hälsa-integration
```
