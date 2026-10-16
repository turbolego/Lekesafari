const { test, expect } = require('@playwright/test');

test('WMS markers load at Burudvann', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  
  // Wait for data to load
  await page.waitForFunction(() => parseInt(document.getElementById('result-count')?.textContent || '0', 10) > 0, null, { timeout: 30000 });
  
  // Pan to Burudvann
  await page.evaluate(() => {
    const map = window.map;
    if (map) {
      map.panTo([59.9739, 10.5133], { animate: true });
    }
  });
  await page.waitForTimeout(3000);
  
  // Wait for WMS markers to load
  const wmsMarkers = await page.waitForFunction(() => {
    return [...state.markerObjects.values()]
      .filter(p => p && p.playground && p.playground.source === 'wms-tilgjengelighet')
      .length > 0;
  }, null, { timeout: 30000 });
  
  const count = await page.evaluate(() => {
    return [...state.markerObjects.values()]
      .filter(p => p && p.playground && p.playground.source === 'wms-tilgjengelighet')
      .length;
  });
  console.log('WMS markers at Burudvann:', count);
  expect(count).toBeGreaterThan(0);
});
