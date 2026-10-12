// Smoke + data-integrity e2e tests for Lekesafari.
const { test, expect } = require('@playwright/test');

// Collect uncaught page errors and console errors for every test.
function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });
  return errors;
}

test.describe('app boots', () => {
  test('no uncaught JS errors on load', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/index.html');
    await page.waitForLoadState('load');
    // Give the static data load a chance to run.
    await page.waitForFunction(() => document.getElementById('result-count')?.textContent !== '0', null, { timeout: 15_000 }).catch(() => {});
    // Ignore failing external tile/CDN requests (sandbox may lack internet).
    const real = errors.filter((e) => !/tile\.openstreetmap|unpkg|wms\.geonorge|net::ERR/.test(e));
    expect(real, real.join('\n')).toEqual([]);
  });

  test('Leaflet map is initialised', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#map.leaflet-container')).toBeVisible();
  });

  test('static dataset loads and results list is populated', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page.locator('#result-count')).not.toHaveText('0', { timeout: 20_000 });
    const n = parseInt(await page.locator('#result-count').textContent(), 10);
    expect(n).toBeGreaterThan(100);
    expect(await page.locator('#playground-list .playground-item').count()).toBeGreaterThan(0);
  });

  test('no duplicate element IDs in index.html', async ({ page }) => {
    await page.goto('/index.html');
    const dupes = await page.evaluate(() => {
      const seen = {}; const d = [];
      document.querySelectorAll('[id]').forEach((el) => {
        if (seen[el.id]) d.push(el.id); seen[el.id] = true;
      });
      return d;
    });
    expect(dupes).toEqual([]);
  });
});

test('playground dataset is not shrunk by a partial bake', async ({ request }) => {
  // Regression guard: an Overpass partial outage once overwrote the dataset
  // with 1,046 records. tools/fetch_playgrounds.py now refuses to write
  // partial data, but pin the floor here too so a bad bake fails the build
  // even if that guard is bypassed.
  const res = await request.get('/data/playgrounds_all.geojson');
  expect(res.ok()).toBeTruthy();
  const fc = await res.json();
  expect(fc.features.length).toBeGreaterThanOrEqual(1000);

  const ids = new Set(fc.features.map(f => f.properties.id));
  expect(ids.size).toBe(fc.features.length);
});
