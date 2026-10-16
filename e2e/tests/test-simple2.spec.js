const { test, expect } = require('@playwright/test');

test('page loads and markers render', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  
  const checks = await page.evaluate(() => {
    const result = {};
    result.leafletLoaded = typeof L !== 'undefined';
    result.mapInWindow = !!window.map;
    result.stateInWindow = typeof state !== 'undefined';
    result.stateMap = typeof state !== 'undefined' ? state.map : undefined;
    result.staticPlaygrounds = typeof state !== 'undefined' ? state.staticPlaygrounds.length : undefined;
    result.markerObjects = typeof state !== 'undefined' ? state.markerObjects.size : undefined;
    result.markerCount = typeof state !== 'undefined' ? state.markerObjects.size : undefined;
    // Leaflet marker icons are now emoji divIcons, not SVG circle markers.
    result.emojiMarkerCount = document.querySelectorAll('.playground-marker-emoji').length;
    result.leafletVersion = typeof L !== 'undefined' ? L.version : undefined;
    return result;
  });
  console.log('CHECKS:', JSON.stringify(checks, null, 2));
});
