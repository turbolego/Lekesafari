// Lekesafari - Seed playground data
// This file contains the vetted example playgrounds

const PLAYGROUNDS = [
  {
    id: 'solbakken-oslo',
    name: 'Solbakken lekeplass',
    location: { lat: 59.9139, lng: 10.7522 },
    source: 'osm',
    verified: true,
    lastVerified: '2026-10-04',
    images: [
      { url: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400', alt: 'Rutschbane' },
      { url: 'https://images.unsplash.com/photo-1559216906-91e0cb497085?w=400', alt: 'Gynge' },
    ],
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
    images: [
      { url: 'https://images.unsplash.com/photo-1578662996442-48f581527e9e?w=400', alt: 'Lekeplass' },
    ],
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