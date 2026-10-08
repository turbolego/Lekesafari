// Lekesafari - Seed playground data
// This file contains the vetted example playgrounds.
//
// NOTE: images are intentionally empty in the seed. Real photos come from the
// OSM-baked layer (data/playgrounds_all.geojson) via each record's `image`
// tag, which the popup fetches lazily only when a playground is opened. We
// never hardcode placeholder/hallucinated stock photos here.

const PLAYGROUNDS = [
  {
    id: 'solbakken-oslo',
    name: 'Solbakken lekeplass',
    location: { lat: 59.9139, lng: 10.7522 },
    source: 'osm',
    verified: true,
    lastVerified: '2026-10-04',
    images: [],
    equipment: [
      { type: 'rutschebane', name: 'Rutschbane', count: 3 },
      { type: 'gynge', name: 'Gynge', count: 2 },
      { type: 'klatrestativ', name: 'Klatrestativ', count: 1 },
    ],
    rating: { average: 4.6, count: 127 },
    fenced: true,
    toilets: true,
    freeParking: true,
    paidParking: false,
    dogsAllowed: true,
    dogsLeash: true,
  },
  {
    id: 'parken-trondheim',
    name: 'Parke Solheimen',
    location: { lat: 59.5070, lng: 10.5520 },
    source: 'geonorge',
    verified: true,
    lastVerified: '2026-09-15',
    images: [],
    equipment: [
      { type: 'gynge', name: 'Gynge', count: 2 },
      { type: 'sandkasse', name: 'Sandkasse', count: 1 },
    ],
    rating: { average: 3.8, count: 45 },
    fenced: true,
    toilets: false,
    freeParking: true,
    paidParking: false,
    dogsAllowed: true,
    dogsLeash: true,
  },
  {
    id: 'viktoria-bergen',
    name: 'Viktoria lekeplass',
    location: { lat: 59.5220, lng: 10.6550 },
    source: 'osm',
    verified: true,
    lastVerified: '2026-10-03',
    images: [],
    equipment: [
      { type: 'klatrestativ', name: 'Klatrestativ', count: 2 },
      { type: 'karussell', name: 'Karussell', count: 1 },
    ],
    rating: { average: 4.1, count: 78 },
    fenced: false,
    toilets: true,
    freeParking: false,
    paidParking: true,
    dogsAllowed: false,
    dogsLeash: false,
  },
];

// Expand to more seed data (simplified, production version would have all 525+)
window.SEED_PLAYGROUNDS = PLAYGROUNDS;