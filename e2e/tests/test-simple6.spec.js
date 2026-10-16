const { test, expect } = require('@playwright/test');

test('check wms request', async ({ page }) => {
  const requests = [];
  page.on('request', (req) => {
    if (req.url().includes('wms.geonorge')) {
      requests.push(req.url());
    }
  });
  page.on('response', (res) => {
    if (res.url().includes('wms.geonorge')) {
      console.log('RESPONSE:', res.status(), res.url());
    }
  });
  
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  
  // Wait for data to load
  await page.waitForFunction(() => parseInt(document.getElementById('result-count')?.textContent || '0', 10) > 0, null, { timeout: 30000 });
  
  // Wait a bit for WMS request
  await page.waitForTimeout(5000);
  
  console.log('WMS requests:', requests);
});
