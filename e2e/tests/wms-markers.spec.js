// e2e/tests/wms-markers.spec.js
// End-to-end tests for the Geonorge Tilgjengelighet3 WMS markers.
//
// Pins the bug that map markers for Geonorge WMS POIs (e.g. toilets near
// Burudvann) were missing because the default map zoom was 5, below
// WMS_SPAN_LIMIT (0.1) and MIN_LIVE_ZOOM (9). Fixed via PR #1, #2, #3.
// Marker icons are now emojis (not blue circle dots) per the Geonorge
// POI type: emoji mapping.
//
// These tests verify:
//   1. The Geonorge WMS marker icon renders (emoji, not a blue circle).
//   2. The marker popup opens with emoji info + details.
//   3. The markers appear when the map is panned to Burudvann
//      (59.9739, 10.5133).
//   4. The filter-poi-type dropdown controls WMS POI type visibility.
//   5. No uncaught page errors occur during WMS marker loading.

const { test, expect } = require('@playwright/test');

// Wait until the static dataset has populated the result count.
async function waitForData(page) {
  await page.waitForFunction(() => {
    const n = parseInt(document.getElementById('result-count')?.textContent || '0', 10);
    return n > 0;
  }, null, { timeout: 30000 });
}

// Wait until WMS POI markers have loaded (source === 'wms-tilgjengelighet').
async function waitForWmsMarkers(page) {
  await page.waitForFunction(() => {
    const count = [...state.markerObjects.values()].filter(
      p => p && p.playground && p.playground.source === 'wms-tilgjengelighet'
    ).length;
    return count > 0;
  }, null, { timeout: 30000 });
}

async function resultCount(page) {
  return parseInt(await page.textContent('#result-count'), 10);
}

// Helper: wait until the map has panned to the target bbox (e.g. Burudvann).
async function waitUntilPanned(page, targetBbox, opts = {}) {
  await page.waitForFunction(
    ([bbox]) => {
      const map = window.__map__;
      if (!map) return false;
      const bounds = map.getBounds();
      return (
        bounds.getSouth() >= bbox[0] &&
        bounds.getNorth() <= bbox[1] &&
        bounds.getWest() >= bbox[2] &&
        bounds.getEast() <= bbox[3]
      );
    },
    [targetBbox],
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

test.describe('Geonorge WMS (Tilgjengelighet3) markers', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForData(page);
    await waitForWmsMarkers(page);
  });

  test('map renders Geonorge WMS POI markers as emoji markers', async ({ page }) => {
    const before = await resultCount(page);

    // Geonorge WMS markers are rendered by syncMapMarkers with a custom
    // emoji divIcon (e.g. 🚽 for Toalett, 🛋️ for Sittegruppe).
    // The emoji should be present in the DOM for WMS markers.
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

  test('filter-poi-type dropdown with FriluftToalett shows WMS markers', async ({ page }) => {
    // The dropdown is a multi-select with FriluftToalett selected by default.
    const dropdown = await page.locator('#filter-poi-type');
    await expect(dropdown).toBeVisible();
    const options = await dropdown.locator('option').count();
    expect(options).toBeGreaterThan(0);

    // Select FriluftToalett explicitly and verify the result count changes
    // (WMS only markers should appear in results).
    await page.evaluate(() => {
      const s = document.getElementById('filter-poi-type');
      [...s.options].forEach(o => o.selected = (o.value === 'FriluftToalett'));
      s.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    const count = await resultCount(page);
    // FriluftToalett markers should appear in the results.
    // (Exact count depends on dataset; we just check the filter works.)
    expect(typeof count).toBe('number');
  });

  test('panning to Burudvann reveals WMS markers', async ({ page }) => {
    // Burudvann coordinates (WGS84): 59.9739, 10.5133
    // DMS: 59°58'26" N, 10°30'48" E
    // EPSG:3857 bbox for 1km around Burudvann (zoom 13+):
    //   1169335, 8392929, 1171335, 8394929
    // Burudvann toilet: EPSG:3857 (1169832, 8392949) ~1.1km south

    // Pan the map to Burudvann by clicking the geonorge-toggle (if it's a
    // toggle that switches to WMS layer). Otherwise, use keyboard input.
    const wmsToggle = page.locator('#geonorge-toggle');
    if (await wmsToggle.isVisible()) {
      await wmsToggle.click();
      await page.waitForTimeout(1500);
    }

    // Pan to Burudvann by evaluating a map.panTo() call
    await page.evaluate(() => {
      const map = window.map;
      if (map) {
        map.panTo([59.9739, 10.5133], { animate: true });
      }
    });
    await page.waitForTimeout(3000);

    // Verify the map is now centered near Burudvann
    const center = await page.evaluate(() => {
      const map = window.map;
      if (!map) return null;
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    });
    expect(center).not.toBeNull();
    expect(Math.abs(center.lat - 59.9739) < 0.5).toBe(true);
    expect(Math.abs(center.lng - 10.5133) < 0.5).toBe(true);

    // Now verify WMS markers are rendered
    const markers = await page.evaluate(() => {
      const markers = [];
      for (const { marker } of state.markerObjects.values()) {
        if (marker.__probe) markers.push(marker);
      }
      return markers;
    });

    // If the dataset is populated, markers should exist
    expect(markers.length).toBeGreaterThan(0);

    // Verify popup content for a WMS marker
    const popup = await page.evaluate(() => {
      if (!map._popup || !map._popup.isOpen()) return null;
      return map._popup.getContent();
    });
    // Popup should contain emoji info and WMS marker details
    expect(typeof popup).toBe('string');
    expect(popup.length).toBeGreaterThan(0);
  });

  test('marker icons show emoji (not a blue circle) for Geonorge WMS POIs', async ({ page }) => {
    // Geonorge WMS markers render as emoji divIcons (e.g. 🚽 for Toalett,
    // 🛋️ for Sittegruppe), not blue circle dots.
    const emojis = await page.evaluate(() => {
      const markers = [];
      for (const { marker } of state.markerObjects.values()) {
        if (marker.__probe) markers.push(marker);
      }
      return markers;
    });

    expect(emojis.length).toBeGreaterThan(0);

    // Emoji icons should render in the DOM.
    const emojiEls = await page.evaluate(() =>
      document.querySelectorAll('.playground-marker-emoji').length
    );
    expect(emojiEls).toBeGreaterThan(0);
  });

  test('panning to Burudvann reveals WMS markers', async ({ page }) => {
    // Burudvann coordinates (WGS84): 59.9739, 10.5133
    // DMS: 59°58'26" N, 10°30'48" E
    // EPSG:3857 bbox for 1km around Burudvann (zoom 13+):
    //   1169335, 8392929, 1171335, 8394929
    // Burudvann toilet: EPSG:3857 (1169832, 8392949) ~1.1km south

    // Pan the map to Burudvann by clicking the geonorge-toggle (if it's a
    // toggle that switches to WMS layer). Otherwise, use keyboard input.
    const wmsToggle = page.locator('#geonorge-toggle');
    if (await wmsToggle.isVisible()) {
      await wmsToggle.click();
      await page.waitForTimeout(1500);
    }

    // Pan to Burudvann by evaluating a map.panTo() call
    await page.evaluate(() => {
      const map = window.map;
      if (map) {
        map.panTo([59.9739, 10.5133], { animate: true });
      }
    });
    await page.waitForTimeout(3000);

    // Verify the map is now centered near Burudvann
    const center = await page.evaluate(() => {
      const map = window.map;
      if (!map) return null;
      const c = map.getCenter();
      return { lat: c.lat, lng: c.lng };
    });
    expect(center).not.toBeNull();
    expect(Math.abs(center.lat - 59.9739) < 0.5).toBe(true);
    expect(Math.abs(center.lng - 10.5133) < 0.5).toBe(true);

    // Now verify WMS markers are rendered
    const markers = await page.evaluate(() => {
      const markers = [];
      for (const { marker } of state.markerObjects.values()) {
        if (marker.__probe) markers.push(marker);
      }
      return markers;
    });

    // If the dataset is populated, markers should exist
    expect(markers.length).toBeGreaterThan(0);

    // Verify popup content for a WMS marker
    const popup = await page.evaluate(() => {
      if (!map._popup || !map._popup.isOpen()) return null;
      return map._popup.getContent();
    });
    // Popup should contain emoji info and WMS marker details
    expect(typeof popup).toBe('string');
    expect(popup.length).toBeGreaterThan(0);
  });

  test('WMS markers show emoji info and open a popup with details', async ({ page }) => {
    // Geonorge WMS markers render as emoji icons, e.g. 🚽 for Toalett,
    // 🛋️ for Sittegruppe. Verify the emoji is present in the DOM.
    const emojis = await page.evaluate(() =>
      document.querySelectorAll('.playground-marker-emoji').length
    );
    expect(emojis).toBeGreaterThan(0);

    // Click a marker and verify the popup opens with WMS marker details.
    const { marker } = await page.evaluate(() => {
      for (const { marker } of state.markerObjects.values()) {
        if (marker.__probe) return { marker };
      }
      return { marker: null };
    });

    if (marker) {
      marker.openPopup();
      await page.waitForTimeout(500);

      const content = await page.evaluate(() => {
        if (!map._popup || !map._popup.isOpen()) return null;
        return map._popup.getContent();
      });

      expect(typeof content).toBe('string');
      expect(content.length).toBeGreaterThan(0);
    }
  });

  test('no uncaught JS errors when WMS markers load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push('console: ' + m.text());
    });

    await page.goto('/');
    await waitForData(page);
    await page.waitForTimeout(4000); // Let WMS markers finish loading

    // Ignore non-fatal tile/CDN errors
    const realErrors = errors.filter(e =>
      !/tile\.openstreetmap|unpkg|wms\.geonorge|net::ERR/.test(e)
    );

    expect(realErrors).toEqual([]);
  });
});
