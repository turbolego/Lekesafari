const { test, expect } = require('@playwright/test');

test('page loads and markers render', async ({ page }) => {
  console.log('Navigating to page...');
  await page.goto('http://127.0.0.1:4173/index.html');
  await page.waitForLoadState('load');
  console.log('Page loaded');
  
  const markerCount = await page.evaluate(() => {
    const markers = document.querySelectorAll('.leaflet-marker-icon');
    return markers.length;
  });
  console.log('DOM marker count:', markerCount);
  
  const emojiCount = await page.evaluate(() => {
    const markers = document.querySelectorAll('.playground-marker-emoji');
    return markers.length;
  });
  console.log('Emoji marker count:', emojiCount);
  
  const wmsCount = await page.evaluate(() => {
    const markers = [];
    for (const { marker } of state.markerObjects.values()) {
      if (marker.__probe) markers.push(marker);
    }
    return markers.length;
  });
  console.log('WMS marker count:', wmsCount);
  
  const mapLoaded = await page.evaluate(() => {
    return !!state.map;
  });
  console.log('Map loaded:', mapLoaded);
  const staticCount = await page.evaluate(() => state.staticPlaygrounds.length);
  console.log('Static playgrounds:', staticCount);
});
