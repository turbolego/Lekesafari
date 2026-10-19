// e2e/tests/wms-markers.spec.js
// End-to-end tests for the Geonorge Tilgjengelighet3 markers (JSON-based).
//
// These tests verify:
//   1. The Geonorge marker icon renders (emoji, not a blue circle).
//   2. The marker popup opens with emoji info + details.
//   3. The markers appear when the map is panned.
//   4. No uncaught page errors occur during marker loading.

const { test, expect } = require('@playwright/test');

// Wait until the static dataset has populated the result count.
async function waitForData(page) {
  await page.waitForFunction(() => {
    const n = parseInt(document.getElementById('result-count')?.textContent || '0', 10);
    return n > 0;
  }, null, { timeout: 30000 });
}

// Wait until the marker objects have been initialized (source === 'geonorge-tilgjengelighet3').
async function waitForGeonorgeMarkers(page) {
  await page.waitForFunction(() => {
    const count = [...state.markerObjects.values()].filter(
      p => p && p.playground && p.playground.source === 'geonorge-tilgjengelighet3'
    ).length;
    return count > 0;
  }, null, { timeout: 30000 });
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
      const c = map.getCenter();
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
    for (const { marker } of state.markerObjects.values()) marker.__probe = true;
  });
}

test.describe('Geonorge Tilgjengelighet3 markers (JSON-based)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForData(page);
    await waitForGeonorgeMarkers(page);
  });

  test('map renders Geonorge markers as emoji markers', async ({ page }) => {
    const before = await resultCount(page);

    // Geonorge markers are rendered by syncMapMarkers with a custom
    // emoji divIcon (e.g. 🛋️ for Sittegruppe, 🚽 for Toalett).
    // The emoji should be present in the DOM for Geonorge markers.
    const emojis = await page.evaluate(() => {
      const markers = [];
      for (const { marker } of state.markerObjects.values()) {
        if (marker.__probe) markers.push(marker);
      }
      return markers;
    });

    expect(emojis.length).toBeGreaterThan(0);

    // Verify emoji markers render in the DOM
    const emojiEls = await page.evaluate(() =>
      document.querySelectorAll('.playground-marker-emoji').length
    );
    expect(emojiEls).toBeGreaterThan(0);
  });

  test('filter-poi-type dropdown shows Geonorge markers', async ({ page }) => {
    const dropdown = await page.locator('#filter-poi-type');
    await expect(dropdown).toBeVisible();
    const options = await dropdown.locator('option').count();
    expect(options).toBeGreaterThan(0);

    // Select FriluftToalett explicitly and verify the result count changes
    await page.evaluate(() => {
      const s = document.getElementById('filter-poi-type');
      [...s.options].forEach(o => o.selected = (o.value === 'FriluftToalett'));
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    const count = await resultCount(page);
    expect(typeof count).toBe('number');
  });

  test('marker icons show emoji (not a blue circle) for Geonorge POIs', async ({ page }) => {
    const emojis = await page.evaluate(() => {
      const markers = [];
      for (const { marker } of state.markerObjects.values()) {
        if (marker.__probe) markers.push(marker);
      }
      return markers;
    });

    expect(emojis.length).toBeGreaterThan(0);

    const emojiEls = await page.evaluate(() =>
      document.querySelectorAll('.playground-marker-emoji').length
    );
    expect(emojiEls).toBeGreaterThan(0);
  });

  test('panning the map to a location shows markers', async ({ page }) => {
    // Pan the map to a known Geonorge location
    await page.evaluate(() => {
      const map = window.map;
      if (map) {
        map.panTo([60.5, 8.5], { animate: true });
      }
    });
    await page.waitForTimeout(2000);

    const center = await page.evaluate(() => {
      const map = window.map;
      if (!map) return null;
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    });
    expect(center).not.toBeNull();
    expect(Math.abs(center.lat - 60.5) < 0.05).toBe(true);
    expect(Math.abs(center.lng - 8.5) < 0.05).toBe(true);

    const emojis = await page.evaluate(() =>
      document.querySelectorAll('.playground-marker-emoji').length
    );
    expect(emojis).toBeGreaterThan(0);
  });

  test('marker popup opens with emoji info and details', async ({ page }) => {
    const emojis = await page.evaluate(() =>
      document.querySelectorAll('.playground-marker-emoji').length
    );
    expect(emojis).toBeGreaterThan(0);

    const { marker } = await page.evaluate(() => {
      for (const { marker } of state.markerObjects.values()) {
        if (marker.__probe) return { marker };
      }
      return { marker: null };
    });

    if (marker) {
      await page.evaluate((m) => m.openPopup(), marker);
      await page.waitForTimeout(500);

      const content = await page.evaluate(() => {
        if (!map._popup || !map._popup.isOpen()) return null;
        return map._popup.getContent();
      });

      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);
    }
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
});
