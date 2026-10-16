const { test, expect } = require('@playwright/test');

test('check map initialization', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  
  const checks = await page.evaluate(() => {
    const result = {};
    result.mapExists = document.getElementById('map') !== null;
    result.mapHeight = document.getElementById('map') ? document.getElementById('map').clientHeight : 0;
    result.htmlBodyHeight = document.documentElement.clientHeight;
    result.mapStyle = document.getElementById('map') ? getComputedStyle(document.getElementById('map')).cssText : '';
    return result;
  });
  console.log('CHECKS:', JSON.stringify(checks, null, 2));
});
