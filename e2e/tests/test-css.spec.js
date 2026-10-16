const { test, expect } = require('@playwright/test');

test('check Leaflet CSS and map', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  
  const checks = await page.evaluate(() => {
    const result = {};
    result.leafletCssLoaded = document.querySelector('link[href*="leaflet.css"]') ? true : false;
    result.leafletCssHref = document.querySelector('link[href*="leaflet.css"]') ? document.querySelector('link[href*="leaflet.css"]').href : '';
    result.mapChildren = document.getElementById('map') ? document.getElementById('map').children.length : 0;
    result.mapStyle = document.getElementById('map') ? getComputedStyle(document.getElementById('map')).cssText : '';
    return result;
  });
  console.log('CHECKS:', JSON.stringify(checks, null, 2));
});
