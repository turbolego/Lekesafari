# Lekesafari 🎡

Kart over lekeplasser i Norge. En statisk PWA (Leaflet) uten byggesteg — deployes
rett til GitHub Pages på `turbolego.github.io/Lekesafari/`.

## Arkitektur

| Fil | Rolle |
| --- | --- |
| `index.html` | Skall, sidebar, filtre. Inline `<style>` for layout. |
| `sources.js` | Dataadaptere + normalisering (`normalizePlayground`). |
| `app-leaflet.js` | Kart, filtre, popup, lister. |
| `data/playgrounds_all.geojson` | Hele datasettet (~3.5 MB), bakt av CI. |
| `sw.js` | Service worker. Alle stier er relative pga. subpath-deploy. |

Data er **bakt på forhånd** av `tools/fetch_playgrounds.py` og oppdateres nattlig
av `.github/workflows/fetch-playgrounds.yml`. Appen kaller aldri Overpass ved
sideinnlasting — speilene er ustabile og ville hengt kartet.

`fetch_playgrounds.py` tiler landet i per-by-bokser fordi ett helnorges-spørsmål
tidsalter. Overlappende bokser dedupes på `sourceId`.

## Kjør lokalt

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory .
# åpne http://127.0.0.1:4173/
```

## E2E-tester

```bash
cd e2e
npm install
npm test
```

Testene kjører mot samme statiske server (`python3 -m http.server 4173`), satt opp
i `e2e/playwright.config.js`. Chromium er pinned til `/usr/bin/google-chrome` med
`--no-sandbox` — ingen nettlesernedlasting nødvendig.

Kjør én fil: `npx playwright test tests/features.spec.js`.

### Hvordan testene styrer UI

Sidebar er utenfor skjermbildet på mobil, så Playwrights synlighetssjekker blokkerer
ekte klikk. I stedet setter testene `.checked`/`.value` direkte og sender
`change`/`input` — det er filterlogikken som testes, ikke layouten.

## Feil fanget av testene

- Søk bygde om alle ~2850 markører per tastetrykk (nå: synlighetsveksling).
- Hunde- og parkeringsfiltre matchet samtlige poster pga. truthy `'unknown'`.
- Aldersfilteret var en taus no-op (flate vs. nøstede felt + streng kontainment).
- Service worker precachede filer som ikke fantes, slik at installasjon feilet.
- OSM-djuplenker pekte på interne id-er (`osm-node-123`) og returnerte 404.
- Resultatlisten bygde ~2850 DOM-noder med hver sin lytter per filterendring.

## Oppdater data lokalt

```bash
pip install requests geojson
python3 tools/fetch_playgrounds.py
```
