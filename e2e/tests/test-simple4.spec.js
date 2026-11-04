const { test, expect } = require('@playwright/test');

test('check window.map and markers', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  
  const checks = await page.evaluate(() => {
    const result = {};
    result.markerKeyCount = Object.keys(playgroundLayer._layers).length;
    result.leafletMarkerCount = Object.keys(playgroundLayer._layers).filter(k => 
      playgroundLayer._layers[k] instanceof L.CircleMarker
    ).length;
    // Leaflet marker icons are now emoji divIcons, not SVG circle markers.
    result.circleMarkerCount = result.leafletMarkerCount;
    result.emojiMarkerCount = document.querySelectorAll('.playground-marker-emoji').length;
    result.window.mapZoom = window.map.getZoom();
    result.window.mapCenter = window.map.getCenter();
    return result;
  });
  console.log('CHECKS:', JSON.stringify(checks, null, 2));
});
