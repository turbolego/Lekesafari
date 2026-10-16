const { test, expect } = require('@playwright/test');

test('check map children', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  
  const checks = await page.evaluate(() => {
    const map = document.getElementById('map');
    return {
      children: Array.from(map.children).map(c => c.tagName + '.' + (c.className || '') + ' (' + (c.style.cssText || '') + ')'),
      leafletMapInHTML: !!window.__leaflet_id__,
    };
  });
  console.log('CHECKS:', JSON.stringify(checks, null, 2));
});
