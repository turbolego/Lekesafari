const { test, expect } = require('@playwright/test');

test('page loads and markers render', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  
  const checks = await page.evaluate(() => {
    const result = {};
    result.leafletLoaded = typeof L !== 'undefined';
    result.window.mapInWindow = !!window.map;
    result.window.stateInWindow = typeof window.state !== 'undefined';
    result.window.stateMap = typeof window.state !== 'undefined' ? window.state.window.map : undefined;
    result.staticPlaygrounds = typeof window.state !== 'undefined' ? window.state.staticPlaygrounds.length : undefined;
    result.markerObjects = typeof window.state !== 'undefined' ? window.state.markerObjects.size : undefined;
    result.markerCount = typeof window.state !== 'undefined' ? window.state.markerObjects.size : undefined;
    // Leaflet marker icons are now emoji divIcons, not SVG circle markers.
    result.emojiMarkerCount = document.querySelectorAll('.playground-marker-emoji').length;
    result.leafletVersion = typeof L !== 'undefined' ? L.version : undefined;
    return result;
  });
  console.log('CHECKS:', JSON.stringify(checks, null, 2));
});
