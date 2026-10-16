// Debug test for WMS markers
const { test } = require('@playwright/test');

test('debug wms markers', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => {
    const n = parseInt(document.getElementById('result-count')?.textContent || '0', 10);
    return n > 0;
  }, null, { timeout: 30000 });

  // Wait for WMS markers
  await page.waitForFunction(() => {
    return [...state.markerObjects.values()].some(p => p && p.playground && p.playground.source === 'wms-tilgjengelighet');
  }, null, { timeout: 10000 }).catch(async () => {
    // Try longer wait
    await new Promise(r => setTimeout(r, 5000));
    const count = await page.evaluate(() =>
      [...state.markerObjects.values()].filter(p => p && p.playground && p.playground.source === 'wms-tilgjengelighet').length
    );
    console.log('WMS markers found after 5s:', count);
  });

  const result = await page.evaluate(() => {
    return {
      wmsCount: [...state.markerObjects.values()].filter(p => p && p.playground && p.playground.source === 'wms-tilgjengelighet').length,
      osmCount: [...state.markerObjects.values()].filter(p => p && p.playground && p.playground.source === 'osm').length,
      geonorgeCount: [...state.markerObjects.values()].filter(p => p && p.playground && p.playground.source === 'geonorge').length,
      wmsCount2: state.markerObjects.size,
      playgroundCount: state.playgrounds?.length || 0,
      staticPlaygrounds: state.staticPlaygrounds?.length || 0,
      stateSources: [...new Set([...state.markerObjects.values()].map(p => p?.playground?.source))],
      sampleWms: [...state.markerObjects.values()].filter(p => p && p.playground && p.playground.source === 'wms-tilgjengelighet').slice(0, 3).map(m => ({ id: m.playground?.id, name: m.playground?.name }))
    };
  });

  console.log(JSON.stringify(result, null, 2));
});
