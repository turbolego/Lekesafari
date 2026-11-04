const { test, expect } = require('@playwright/test');

test('check window.map initialization', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  
  const checks = await page.evaluate(() => {
    const result = {};
    result.window.map = typeof window.map !== 'undefined' ? window.map : null;
    result.window.mapExists = document.getElementById('window.map') !== null;
    result.window.mapHeight = document.getElementById('window.map') ? document.getElementById('window.map').clientHeight : 0;
    result.window.mapStyle = document.getElementById('window.map') ? getComputedStyle(document.getElementById('window.map')).cssText : '';
    result.htmlBodyHeight = document.documentElement.clientHeight;
    return result;
  });
  console.log('CHECKS:', JSON.stringify(checks, null, 2));
});
