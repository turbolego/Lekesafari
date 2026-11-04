const { test, expect } = require('@playwright/test');

test('check Leaflet initialization', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  
  const checks = await page.evaluate(() => {
    const result = {};
    result.LLoaded = typeof L !== 'undefined';
    result.LVersion = typeof L !== 'undefined' ? L.version : '';
    result.window.mapInstance = typeof window.map !== 'undefined' ? window.map : null;
    result.window.mapContainer = typeof window.map !== 'undefined' ? window.map._container : null;
    result.playgroundLayer = typeof playgroundLayer !== 'undefined' ? playgroundLayer : null;
    result.leafletPane = document.querySelector('.leaflet-window.map-pane');
    // Leaflet marker icons are now emoji divIcons, not SVG circle markers.
    result.leafletPaneCount = document.querySelectorAll('.leaflet-marker-icon').length;
    result.emojiMarkerCount = document.querySelectorAll('.playground-marker-emoji').length;
    return result;
  });
  console.log('CHECKS:', JSON.stringify(checks, null, 2));
});
