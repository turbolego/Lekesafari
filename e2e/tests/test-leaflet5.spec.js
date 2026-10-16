const { test, expect } = require('@playwright/test');

test('check Leaflet initialization', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  
  const checks = await page.evaluate(() => {
    const result = {};
    result.LLoaded = typeof L !== 'undefined';
    result.LVersion = typeof L !== 'undefined' ? L.version : '';
    result.mapInstance = typeof map !== 'undefined' ? map : null;
    result.mapContainer = typeof map !== 'undefined' ? map._container : null;
    result.playgroundLayer = typeof playgroundLayer !== 'undefined' ? playgroundLayer : null;
    result.leafletPane = document.querySelector('.leaflet-map-pane');
    // Leaflet marker icons are now emoji divIcons, not SVG circle markers.
    result.leafletPaneCount = document.querySelectorAll('.leaflet-marker-icon').length;
    result.emojiMarkerCount = document.querySelectorAll('.playground-marker-emoji').length;
    return result;
  });
  console.log('CHECKS:', JSON.stringify(checks, null, 2));
});
