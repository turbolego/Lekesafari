Jeg skal lage en webapp med github pages og trenger åpne kartlag med info om parker med lekeapparater.

Lekesafari speks:

1. Kun pins


2. Ta bilder


3. Rating


4. Må kunne trykke knapp for å åpne lokasjon i google maps eller apple maps


5. Aldersgruppe


6. Åpningstider


7. Apparater


8. Lov med hund


9. Inngjerdet


10. Toaletter


11. Parkering gratis eller mot betaling


12. Kartsøk med filter, oppdateres ut ifra zoom osv.


13. Flere datakilder for kartlag


"""

Ja. Dette egner seg veldig godt som en statisk GitHub Pages-app, men jeg ville skilt mellom kartdata og Lekesafari-data. Da kan du bruke åpne kartkilder uten å måtte bygge hele databasen selv.

Anbefalt arkitektur

Jeg ville bygget:

GitHub Pages → React/Vite
→ MapLibre GL JS
→ åpne kart-/vektordata
→ egne Lekesafari-data i en database/API

MapLibre er spesielt egnet fordi det er en åpen WebGL-basert kartmotor som håndterer vektorfliser, GeoJSON og dynamiske kartlag. 

Viktig skille

Kartet skal ikke være databasen.

Kartet kan hente:

OSM

Kartverket/Geonorge

kommunale datasett

eventuelt andre åpne datasett


Mens Lekesafari kan legge oppå dette:

bilder

brukerrating

egne vurderinger

favoritter

verifisering

informasjon som ikke finnes i åpne kilder



---

1. OpenStreetMap bør være hovedkilden

Dette er faktisk en veldig god match med kravene dine.

OSM har leisure=playground, og kan blant annet inneholde:

navn

minimumsalder

maksimumsalder

åpningstider

operator

tilgang

inngjerding

betaling

underlag

rullestoltilgjengelighet

barnevogn

lekeapparater




Eksempel:

leisure=playground
name=Solbakken lekeplass
min_age=2
max_age=12
opening_hours=Mo-Su 08:00-20:00
fenced=yes
fee=no
wheelchair=yes

Og apparater kan kartlegges separat med playground=*. 

Det betyr at OSM allerede dekker overraskende mye av spesifikasjonen din.


---

2. Kartverket/Geonorge er en annen viktig kilde

Dette er spesielt interessant for Norge.

Kartverket har et eget objekttype-register for Lekeplass. Det beskriver blant annet lekeplasser som geografiske objekter og har regler for hvilke lekeplasser som skal registreres. 

Det gir deg en veldig nyttig strategi:

┌───────────────┐
                 │   Geonorge    │
                 │   Kartverket  │
                 └───────┬───────┘
                         │
                         ▼
┌────────────┐     ┌───────────────┐
│    OSM     │ ──► │   Lekesafari  │
└────────────┘     │   data model  │
                   └───────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
           pins         detaljer      rating

Det er også en fin måte å finne lekeplasser som OSM ikke har.


---

3. Jeg ville laget ett samlet Lekesafari-objekt

Uansett hvor informasjonen kommer fra, normaliserer du den til én modell.

For eksempel:

interface Playground {
  id: string;

  name: string;

  location: {
    lat: number;
    lng: number;
  };

  address?: string;

  age?: {
    min?: number;
    max?: number;
  };

  openingHours?: string;

  equipment?: string[];

  dogs?: "yes" | "leashed" | "no" | "unknown";

  fenced?: boolean;

  toilets?: boolean;

  parking?: {
    available: boolean;
    free?: boolean;
  };

  wheelchair?: "yes" | "limited" | "no" | "unknown";

  rating?: {
    average: number;
    count: number;
  };

  photos?: Photo[];

  sources: DataSource[];

  lastVerified?: string;
}

Men jeg ville gått ett skritt videre og lagret kilden for hvert enkelt felt.

For eksempel:

{
  "name": {
    "value": "Ladeparken",
    "source": "osm"
  },

  "fenced": {
    "value": true,
    "source": "user",
    "verified": "2026-10-04"
  },

  "toilets": {
    "value": true,
    "source": "municipality"
  }
}

Det blir veldig nyttig senere.


---

4. Flere datakilder bør være en kjernefunksjon

Kravet ditt:

> 13. Flere datakilder for kartlag





Jeg ville derfor laget et source adapter-system.

For eksempel:

sources/
   osm.ts
   geonorge.ts
   trondheim.ts
   bergen.ts
   oslo.ts

Alle returnerer samme interne format:

Playground[]

Dermed kan du gjøre:

const playgrounds = mergeSources([
  await osmSource.load(bounds),
  await geonorgeSource.load(bounds),
  await municipalitySource.load(bounds)
]);

Og deduplisere etter:

coordinates
+
name
+
distance


---

5. Kartet bør bare vise pins

Dette passer veldig godt med spesifikasjonen din:

> Kun pins



Jeg ville ikke tegnet selve lekeplasspolygonene i første versjon.

Kartet:

🟢       🟢

             🟢

    🟢               🟢

             🟢

Klikk på pin:

┌─────────────────────────────┐
│ 🛝 Lekeplassen på Lade      │
│                             │
│ ⭐ 4.6                      │
│ 👶 2–12 år                  │
│ 🐕 Hund: Ja                 │
│ 🚻 Toalett                  │
│ 🅿️ Gratis parkering         │
│                             │
│ [ Google Maps ] [ Apple ]   │
│                             │
│ [ Se lekeplassen ]          │
└─────────────────────────────┘


---

6. Kartet bør være viewport-basert

Dette er viktig for punkt 12:

> Kartsøk med filter, oppdateres ut ifra zoom osv.



Ikke hent hele Norge.

Bruk kartets bounding box:

map.on("moveend", () => {
    const bounds = map.getBounds();

    loadPlaygrounds({
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth()
    });
});

Da kan du gjøre:

Zoom 8
→ hent mange/grove data

Zoom 12
→ hent alle relevante lekeplasser

Zoom 15
→ hent detaljer

Zoom 17
→ hent bilder + detaljer + apparater

Dette er mye bedre enn å laste inn 50 000 objekter ved oppstart.

Overpass støtter bounding-box-spørringer, og dokumentasjonen anbefaler bounding box fremfor around når det er mulig fordi det er raskere. 


---

7. Men ikke kall Overpass direkte for hvert kartdrag i produksjon

Dette er en viktig arkitekturbeslutning.

Jeg ville ikke gjort:

Browser
   ↓
Overpass

hver gang brukeren flytter kartet.

Det kan fungere i en prototype, men blir dårlig når mange bruker appen.

I stedet:

GitHub Actions
                   │
       ┌───────────┴───────────┐
       ▼                       ▼
    Overpass                Geonorge
       │                       │
       └──────────┬────────────┘
                  ▼
             normalisering
                  │
                  ▼
            playgrounds.json
                  │
                  ▼
             GitHub Pages

Eller senere:

Browser
   │
   ▼
Cloudflare Worker / API
   │
   ├── OSM
   ├── Geonorge
   └── egne data

For en første versjon ville jeg faktisk startet med GitHub Actions + statiske GeoJSON-filer.


---

8. GitHub Pages passer derfor veldig bra

Du trenger ikke server for selve appen.

GitHub
│
├── src/
│
├── public/
│   └── data/
│       ├── playgrounds.geojson
│       └── sources.json
│
└── .github/
    └── workflows/
        └── update-data.yml

GitHub Actions kan periodisk:

1. hente OSM


2. hente Geonorge


3. hente kommunale datasett


4. normalisere


5. deduplisere


6. generere GeoJSON


7. committe/publisere data



Da får du en helt statisk webapp.


---

9. Rating og bilder er annerledes

Her kommer den eneste store utfordringen med "GitHub Pages only".

GitHub Pages kan ikke selv lagre:

rating
bilder
brukere
kommentarer

Du trenger derfor en ekstern backend for dette.

Jeg ville vurdert:

Alternativ A – Supabase

GitHub Pages
     │
     ├── kartdata → statiske GeoJSON
     │
     └── brukerdata → Supabase
                       ├── ratings
                       ├── photos
                       └── playground metadata

Dette er sannsynligvis det jeg ville valgt.

Alternativ B – Cloudflare

GitHub Pages:

Frontend

Cloudflare:

Worker
D1
R2

Da får du:

database

API

bildeopplasting

object storage


uten å ha en tradisjonell server.


---

10. Google Maps + Apple Maps er enkelt

Du trenger faktisk ikke Google Maps API for dette.

Google støtter Maps URLs, blant annet:

https://www.google.com/maps/search/?api=1&query=...

og disse kan åpne Google Maps på riktig plattform. 

Apple Maps støtter tilsvarende vanlige map links med koordinater/adresse. 

Dermed kan knappen være:

📍 Åpne i kart

[ Google Maps ] [ Apple Maps ]

Eksempel:

const googleMaps =
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

const appleMaps =
  `https://maps.apple.com/?ll=${lat},${lng}&q=${encodeURIComponent(name)}`;

Ingen API-nøkkel nødvendig for selve åpningen.


---

11. Filtrene dine kan bli veldig bra

Jeg ville laget et filterpanel som dette:

LEKESAFARI

🔎 Søk etter lekeplass

Alder
☐ 0–2
☐ 2–5
☐ 5–8
☐ 8–12
☐ 12+

Fasiliteter
☐ Inngjerdet
☐ Toalett
☐ Parkering
☐ Gratis parkering
☐ Rullestolvennlig

Hund
☐ Hund tillatt
☐ Hund i bånd

Utstyr
☐ Huske
☐ Sklie
☐ Klatrestativ
☐ Sandkasse
☐ Karusell
☐ Vannlek

Rating
⭐ 4+
⭐ 3+

Og:

┌──────────────────────────────┐
│  🗺️ KART                     │
│                              │
│    🟢       🟢               │
│             🟢               │
│   🟢                 🟢      │
│                              │
│         🟢                   │
│                              │
├──────────────────────────────┤
│  23 lekeplasser              │
└──────────────────────────────┘


---

12. Jeg ville også ha "datakvalitet"

Dette tror jeg kan bli en veldig bra del av Lekesafari.

For eksempel:

🟢 Verifisert

> Informasjonen er bekreftet av Lekesafari-brukere.



🔵 Offentlig kilde

> Informasjon hentet fra kommunen.



⚪ OpenStreetMap

> Informasjon hentet fra OpenStreetMap.



🟠 Ikke bekreftet

> Informasjonen kan være utdatert.



Og:

Sist kontrollert:
12. september 2026

Da unngår du problemet med at appen gir inntrykk av at alle data er korrekte.


---

13. Data provenance bør være innebygd

Jeg ville faktisk lagret:

interface DataSource {
  type:
    | "osm"
    | "geonorge"
    | "municipality"
    | "user";

  id?: string;

  retrievedAt: string;

  url?: string;
}

Eksempel:

"sources": [
  {
    "type": "osm",
    "retrievedAt": "2026-10-04"
  },
  {
    "type": "municipality",
    "retrievedAt": "2026-10-04"
  }
]

Det gjør prosjektet mye mer robust.


---

14. En ekstra interessant mulighet: OSM som crowdsourced kartlag

OSM har allerede mye av informasjonen du trenger:

Lekesafari	OSM

Aldersgruppe	min_age, max_age
Åpningstid	opening_hours
Apparater	playground=*
Inngjerdet	fenced
Toalett	amenity=toilets
Betaling	fee
Hund	dog
Operator	operator
Rullestol	wheelchair
Park	leisure=park
Lekeplass	leisure=playground


OSM beskriver også hundetilgang på parker med blant annet dog=yes, dog=no, dog=leashed osv. 

Det betyr at Lekesafari kan bli et mye bedre brukergrensesnitt for eksisterende åpne data, i stedet for å måtte registrere alle lekeplasser manuelt.


---

15. Min anbefalte teknologistack

Jeg ville gått for:

Frontend
────────
React
TypeScript
Vite
MapLibre GL JS

Kart
────
OpenStreetMap
Geonorge/Kartverket
kommunale åpne data

Data
────
GeoJSON / vector tiles
GitHub Actions

Brukerdata
──────────
Supabase eller Cloudflare

Hosting
───────
GitHub Pages

Bilder
──────
Supabase Storage eller Cloudflare R2

MapLibre kan både vise GeoJSON og eksterne vector/raster sources, så du er ikke låst til én kartleverandør. 


---

Jeg ville bygget MVP-en slik

Fase 1 – fungerer helt uten backend

GitHub Pages

MapLibre

OSM-basemap

OSM playground-data

Geonorge playground-data

pins

klikk på pin

filter

aldersgruppe

apparater

åpningstider

hund

inngjerdet

toalett

parkering

Google Maps

Apple Maps


Fase 2

Legg til:

bilder

rating

favoritter

"var her"

brukerbidrag

rapporter feil


Fase 3

Legg til:

automatisk datainnhenting

kommunale datasett

datakvalitet

deduplisering

"sist kontrollert"

flere norske kommuner



---

Én ting jeg ville endret i spesifikasjonen

Jeg ville gjort "Kilde" til punkt 14:

> 14. Datakilde og sist oppdatert



Og gjerne:

Datakilder:
✓ OpenStreetMap
✓ Trondheim kommune
✓ Lekesafari bruker

Dette blir spesielt viktig fordi du kombinerer data fra OSM, Kartverket og kommuner, hvor informasjonen kan være ulik eller utdatert.

Kort sagt: OSM + Geonorge er et veldig godt utgangspunkt for Lekesafari. OSM har allerede tags som treffer store deler av kravlisten din, mens Geonorge gir deg en norsk offentlig datakilde. 

Hvis dette er prosjektet du skal begynne å kode nå, ville jeg valgt Vite + React + TypeScript + MapLibre + GitHub Pages, og laget første versjon slik at alle lekeplasser kommer fra åpne datasett før vi introduserer database/rating/bilder.
"""
Dette høres ut som et utrolig morsomt og nyttig prosjekt! «Lekesafari» er et glimrende konsept.
Siden du skal hoste webappen på GitHub Pages, er det viktig å huske at dette kun støtter statiske filer (HTML, CSS, JavaScript/TypeScript). Flere av kravene dine (som bildeopplasting og rating) krever en backend/database. Dette løser du elegant med en "Backend-as-a-Service" (BaaS) som Supabase eller Firebase som snakker med frontend-appen din.
Her er en oversikt over hvordan du skaffer dataene du trenger, og hvordan du kan løse spesifikasjonene dine rent teknisk.
📍 Åpne datakilder for lekeplasser (Kartlag)
For å få et godt grunnlag med "flere datakilder", bør du kombinere globale og lokale data. Frontend-appen din kan hente disse inn som GeoJSON og tegne dem som pins.
1. OpenStreetMap (OSM) via Overpass API (Viktigst for dynamisk søk)
Dette er den desidert beste kilden for hele landet. Du kan gjøre spørringer i sanntid basert på kartets bounding box (utsnitt) når brukeren zoomer eller panorerer.
 * Hoved-tag: leisure=playground
 * Tilleggs-tags (som dekker speksene dine):
   * Apparater: playground=swing, playground=slide, playground=sandpit osv.
   * Inngjerdet: barrier=fence
   * Hund: dog=yes / dog=no / dog=leashed
   * Toalett i nærheten: Sjekk etter amenity=toilets i en viss radius.
   * Tilgjengelighet (WCAG/Universell utforming): wheelchair=yes
2. Offentlige åpne data (Norge/Kommunalt)
 * GeoNorge: Har nasjonale datasett for friluftsliv og anlegg.
 * Oslo Kommune Åpne Data: Oslo har et eget API/datasett spesifikt for kommunale lekeplasser med informasjon om apparater.
 * Bærum Kommune: Tilbyr ofte åpne datasett via egne kartportaler eller GeoNorge som du kan eksportere som GeoJSON og legge ved i repoet ditt som et statisk kartlag.
🛠️ Hvordan løse de 13 spesifikasjonene
Her er en breakdown av hvordan du teknisk løser hvert punkt med en GitHub Pages-arkitektur:
Kun frontend (Løses direkte i nettleseren)
 * 1. Kun pins: Bruk et kartbibliotek som Leaflet eller MapLibre GL JS. Du slår av alle standard POI-er (Points of Interest) i selve kartstilen (f.eks. via Mapbox Studio eller ved å velge et "clean" bakgrunnskart), og lar koden din utelukkende tegne opp pins basert på dataene du henter inn. Leaflet er for øvrig veldig robust med tanke på skjermlesere og tastaturnavigasjon (WCAG).
 * 4. Åpne lokasjon i Apple/Google Maps: Dette er enkle lenker du genererer i popup-en til hver pin basert på lengde- og breddegrad:
   * Google Maps: [https://www.google.com/maps/dir/?api=1&destination=](https://www.google.com/maps/dir/?api=1&destination=){lat},{lon}
   * Apple Maps: [https://maps.apple.com/?daddr=](https://maps.apple.com/?daddr=){lat},{lon}
 * 12. Kartsøk med filter og zoom-oppdatering: Du lytter på kartets moveend-event. Når brukeren flytter kartet, henter du ut de nye koordinatene (bounding box) og gjør et nytt API-kall til Overpass API og din egen database, og filtrerer pinsene i klienten basert på valgte filter-toggles.
 * 13. Flere datakilder: Du lager asynkrone funksjoner som henter GeoJSON fra OSM, lokale filer (kommunedata), og databasen din. Siden de alle mappes til pins på kartet, smelter kildene sammen i UI-et.
Krever Backend / Database (F.eks. Supabase)
Siden OSM og kommunedata sjelden har all informasjonen (spesielt bilder, rating og aldersgruppe), trenger du en backend. Supabase (gratis tier) er et strålende valg som fungerer perfekt sammen med statiske nettsider.
 * 2. Ta bilder: Brukeren tar bilde i nettleseren (HTML5 <input type="file" accept="image/*" capture="camera">). Bildet lastes opp til Supabase Storage, og URL-en lagres i databasen knyttet til lekeplassens ID.
 * 3. Rating: Du oppretter en tabell i databasen (f.eks. ratings) med lekeplass_id og score. Appen din henter snittet og viser stjerner på pinnen.
 * 5. Aldersgruppe: Dette er ofte subjektivt og sjelden strukturert i OSM. La brukerne "tagge" lekeplassen (f.eks. "Småbarn 0-3", "Større barn 4+") via appen, og lagre dette i databasen.
 * 6-11. Åpningstider, apparater, hund, inngjerdet, toalett, parkering: Mye av dette kan hentes fra OSM eller kommunen. Men hvis informasjonen mangler i de åpne datasettene, bør appen din ha en funksjon for å "Foreslå endring" / "Legge til info", som da lagres i din database. Når appen laster en pin, fletter (merger) den OSM-dataen med eventuelle overstyringer eller tillegg fra databasen din.
💡 Arkitekturforslag for "Lekesafari"
 * Frontend: Angular, React eller ren TypeScript med Vite. Bygges og dyttes til GitHub Pages via GitHub Actions.
 * Kartmotor: Leaflet.js (med marker-clustering hvis det blir veldig mange lekeplasser i ett område). Lett å gjøre universelt utformet.
 * Database & Auth: Supabase (PostgreSQL under panseret). Her lagrer du brukergenerert innhold:
   * Lekeplass_tillegg (ID, has_fence, has_toilets, is_free_parking)
   * Reviews (ID, lekeplass_id, rating, comment)
   * Photos (Storage-bøtte)
 * Backend-logikk for OSM: Du kan skrive et lite Overpass-query som ser omtrent slik ut for å hente lekeplasser i Bærum/Oslo-området, som du kjører live i appen:
   [out:json][timeout:25];
(
  node["leisure"="playground"]({{bbox}});
  way["leisure"="playground"]({{bbox}});
);
out center;

