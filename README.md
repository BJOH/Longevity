# Longevity

Personlig, mobilanpassad hälsotracker för ett långt liv. Checka av dagliga mål
och följ kurvor för **vikt, intermittent fasta, träning/steg och sömn**, och
planera **veckans måltider** tillsammans. Appen är offline-first: allt fungerar
lokalt i webbläsaren, och med ett konto synkas datan via Supabase mellan
enheter och mellan hushållets två konton.

## Funktioner

- **Idag** — dagens mål som checklista med progressring och streak-räknare
  (väg dig, fasta X h, träna X min, gå X steg, sov X h, ät enligt plan).
  Fastan beräknas automatiskt ur ätfönstret (första/sista måltid).
- **Trender** — kurvor med mållinjer för vikt, sömn, fasta, träning och steg
  över 7/30/90/365 dagar, med tooltip och direktetiketter. Mörkt läge stöds.
- **Måltider** — delad veckoplan (frukost/lunch/middag) mellan hushållets två
  konton; alla ser vem som lagt in vad.
- **Historik** — tabell över alla loggade dagar.
- **Konto & synk** — valfritt konto (Supabase) synkar hälsodata och mål mellan
  enheter. Hälsodatan är privat per konto (Row Level Security); endast
  måltidsplanen delas. Registreringen är låst till max två konton.
  Utan konto, eller offline, fungerar allt lokalt — ändringar köas och
  skickas när nätet är tillbaka.
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

Vanilla JS (ES-moduler), handritade SVG-diagram, localStorage som lokalt
datalager och Supabase (Postgres + Auth) för synk. supabase-js är inbundlad i
repot (`js/vendor/`) så sajten har inga CDN-beroenden i drift. Inget byggsteg.

```
index.html              appskal med fem vyer
css/style.css           stilar, ljust + mörkt tema
js/store.js             lokalt datalager (localStorage), mål & streaks
js/charts.js            SVG-linje/stapeldiagram med tooltip
js/import.js            Apple Health-import (export.xml, Health Auto Export, #log-URL)
js/config.js            Supabase-URL + publik nyckel
js/cloud.js             Supabase-klient: konto, poster, mål, måltidsplan
js/sync.js              synk-orkestrering med offline-kö
js/vendor/supabase-js.js  inbundlad @supabase/supabase-js
js/app.js               vyer och händelser
sw.js                   offline-cache
docs/apple-health.html  guide för Apple Hälsa-integration
```

### Backend (Supabase)

Tabeller: `profiles` (namn + mål per konto), `entries` (dagliga hälsoposter,
privata via RLS), `meal_plans` (delad veckoplan, unik per datum + måltidstyp).
En databastrigger skapar profilen vid registrering och en annan blockerar
fler än två konton. Migrationerna ligger i Supabase-projektet
(`initial_schema`, `harden_and_limit_household`).
