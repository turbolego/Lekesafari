const { test, expect } = require('@playwright/test');

test('check wms markers', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  
  // Wait for data to load
  await page.waitForFunction(() => parseInt(document.getElementById('result-count')?.textContent || '0', 10) > 0, null, { timeout: 30000 });
  
  const checks = await page.evaluate(() => {
    const result = {};
    // Check WMS markers
    const wmsMarkers = [...state.markerObjects.values()]
      .filter(p => p && p.playground && p.playground.source === 'wms-tilgjengelighet');
    result.wmsMarkerCount = wmsMarkers.length;
    
    // Check if map is at Burudvann
    const mapZoom = map ? map.getZoom() : null;
    const mapCenter = map ? map.getCenter() : null;
    result.mapZoom = mapZoom;
    result.mapCenter = mapCenter;
    
    // Check if the WMS layer is visible
    result.geonorgeVisible = typeof geonorgeVisible !== 'undefined' ? geonorgeVisible : null;
    
    // Check the WMS request is being made
    return result;
  });
  console.log('CHECKS:', JSON.stringify(checks, null, 2));
});
