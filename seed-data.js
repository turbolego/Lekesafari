// Lekesafari - Seed playground data
// This file intentionally left empty. All playground data now comes from:
// - data/playgrounds_all.geojson (primary OSM-baked static layer loaded at any zoom)
// - Live Overpass requests via sources.js (active at zoom >= 9)
// The seed fallback was removed to avoid hallucinated/fabricated entries.

const PLAYGROUNDS = [];

// Export for backwards compatibility with any code expecting the old array
window.SEED_PLAYGROUNDS = PLAYGROUNDS;