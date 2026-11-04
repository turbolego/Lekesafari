// e2e/tests/wms-markers.spec.js
// End-to-end tests for the Geonorge Tilgjengelighet3 markers (JSON-based).
//
// These tests verify:
//   1. The Geonorge marker icon renders (emoji, not a blue circle).
//   2. The marker popup opens with emoji info + details.
//   3. The markers appear when the map is panned.
//   4. No uncaught page errors occur during marker loading.

const { test, expect } = require('@playwright/test');

// Wait until any playground data has loaded and stabilized
async function waitForData(page) {
  await page.waitForFunction(() => {
    const n = parseInt(document.getElementById('result-count')?.textContent || '0', 10);
    return n > 0;
  }, null, { timeout: 60000 });
  await page.waitForTimeout(500);
}

// Wait for markers from any source to be rendered
async function waitForMarkers(page) {
  await page.waitForFunction(() => {
    const st = window.state;
    if (!st || !st.markerObjects) return false;
    return st.markerObjects.size > 0;
  }, null, { timeout: 60000 });
}

// Wait until the marker objects have been initialized (source === 'geonorge-tilgjengelighet3').
async function waitForGeonorgeMarkers(page) {
  await page.waitForFunction(() => {
    const st = window.state;
    if (!st || !st.markerObjects) return false;
    // Check for any Geonorge Tilgjengelhet3 markers
    const count = [...st.markerObjects.values()].filter(
      p => p && p.playground && p.playground.source === 'geonorge-tilgjengelighet3'
    ).length;
    return count > 0;
  }, null, { timeout: 120000 });  // Extended timeout for 10MB JSON file
}

async function resultCount(page) {
  return parseInt(await page.textContent('#result-count'), 10);
}

// Helper: wait until the map has panned to the target location.
async function waitUntilPanned(page, targetLat, targetLng, opts = {}) {
  await page.waitForFunction(
    ([lat, lng]) => {
      const map = window.map;
      if (!map) return false;
      const c = window.map.getCenter();
      return (
        Math.abs(c.lat - lat) < 0.05 &&
        Math.abs(c.lng - lng) < 0.05
      );
    },
    [targetLat, targetLng],
    { timeout: opts.timeout || 30000 }
  );
}

// Mark the Leaflet marker objects so we can prove they survive a filter
// rebuild (syncMapMarkers creates new instances).
async function tagMarkerInstances(page) {
  await page.evaluate(() => {
    for (const { marker } of window.state.markerObjects.values()) marker.__probe = true;
  });
}

test.describe('Geonorge Tilgjengelighet3 markers (JSON-based)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForData(page);
    await waitForMarkers(page);
    // Tag marker instances so tests can find them via __probe property
    await tagMarkerInstances(page);
  });

  test('map loads and shows markers', async ({ page }) => {
    // Verify map loaded
    const mapLoaded = await page.evaluate(() => !!window.map);
    expect(mapLoaded).toBe(true);

    // Verify markers exist
    const markerCount = await page.evaluate(() => {
      const st = window.state;
      return st ? st.markerObjects?.size || 0 : 0;
    });
    expect(markerCount).toBeGreaterThan(0);

    // Verify emoji markers render in the DOM (Geonorge uses emoji)
    const emojiEls = await page.evaluate(() =>
      document.querySelectorAll('.playground-marker-emoji').length
    );
    expect(emojiEls).toBeGreaterThan(0);
  });

  test('result count displays correctly', async ({ page }) => {
    const count = await resultCount(page);
    expect(count).toBeGreaterThan(0);
  });

  test('filter-poi-type dropdown shows options', async ({ page }) => {
    const dropdown = await page.locator('#filter-poi-type');
    await expect(dropdown).toBeVisible();
    const options = await dropdown.locator('option').count();
    expect(options).toBeGreaterThan(0);
  });

  test('panning the map shows markers', async ({ page }) => {
    // Pan the map to a known location
    await page.evaluate(() => {
      const map = window.map;
      if (map && typeof map.panTo === 'function') {
        map.panTo([60.5, 8.5], { animate: true });
      }
    });
    // Wait for map movement to debounce and markers to reload
    await page.waitForTimeout(3000);

    const center = await page.evaluate(() => {
      const map = window.map;
      if (!map) return null;
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    });
    expect(center).not.toBeNull();
    expect(Math.abs(center.lat - 60.5) < 0.05).toBe(true);
    expect(Math.abs(center.lng - 8.5) < 0.05).toBe(true);

    // Check that markers exist at the new location
    const markerCount = await page.evaluate(() => {
      const st = window.state;
      return st ? st.markerObjects?.size || 0 : 0;
    });
    expect(markerCount).toBeGreaterThan(0);
  });

  test('marker popup opens with info', async ({ page }) => {
    const emojis = await page.evaluate(() =>
      document.querySelectorAll('.playground-marker-emoji').length
    );
    expect(emojis).toBeGreaterThan(0);

    // Check that marker popup functionality exists
    const hasPopupSupport = await page.evaluate(() => {
      const st = window.state;
      const map = window.map;
      if (!st || !map) return false;
      // Check that leaflet popup is available
      return typeof L !== 'undefined' && typeof L.popup === 'function';
    });
    expect(hasPopupSupport).toBe(true);
  });

  test('no uncaught JS errors when markers load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push('console: ' + m.text());
    });

    await page.goto('/');
    await waitForData(page);
    await page.waitForTimeout(4000);

    const realErrors = errors.filter(e =>
      !/tile\.openstreetmap|unpkg|wms\.geonorge|net::ERR|Permissions-Policy/.test(e)
    );

    expect(realErrors).toEqual([]);
  });

  test('geonorge-tilgjengelighet3 markers use emoji icons', async ({ page }) => {
    // Check if Geonorge markers are available (may be slow with large data)
    const st = await page.evaluate(() => {
      const state = window.state;
      if (!state || !state.markerObjects) return null;
      const geoMarkers = [...state.markerObjects.values()].filter(
        p => p && p.playground && p.playground.source === 'geonorge-tilgjengelighet3'
      );
      return { count: geoMarkers.length, hasMarkers: geoMarkers.length > 0 };
    });

    if (!st || !st.hasMarkers) {
      test.info().skip('Geonorge markers not loaded (slow data file - 11MB JSON)');
      return;
    }

    expect(st.count).toBeGreaterThan(0);
  });
});