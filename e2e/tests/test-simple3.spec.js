const { test, expect } = require('@playwright/test');

test('check window.map and markers', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  
  const checks = await page.evaluate(() => {
    const result = {};
    result.playgroundLayer = typeof playgroundLayer !== 'undefined' ? playgroundLayer._layers : undefined;
    result.markerKeyCount = typeof playgroundLayer !== 'undefined' ? Object.keys(playgroundLayer._layers).length : undefined;
    result.window.mapZoom = typeof window.map !== 'undefined' ? window.map.getZoom() : undefined;
    result.window.mapCenter = typeof window.map !== 'undefined' ? window.map.getCenter() : undefined;
    // Leaflet marker icons are now emoji divIcons, not SVG circle markers.
    result.leafletMarkerCount = typeof playgroundLayer !== 'undefined' 
      ? Object.keys(playgroundLayer._layers).filter(k => playgroundLayer._layers[k] instanceof L.CircleMarker).length 
      : 0;
    result.emojiMarkerCount = document.querySelectorAll('.playground-marker-emoji').length;
    return result;
  });
  console.log('CHECKS:', JSON.stringify(checks, null, 2));
});
