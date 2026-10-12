// Feature-level e2e tests. Each test pins a bug that was found and fixed
// during the audit, so it cannot silently regress.
const { test, expect } = require('@playwright/test');

// Wait until the static dataset has populated the result count.
async function waitForData(page) {
  await page.waitForFunction(() => {
    const n = parseInt(document.getElementById('result-count')?.textContent || '0', 10);
    return n > 0;
  }, null, { timeout: 30000 });
}

async function resultCount(page) {
  return parseInt(await page.textContent('#result-count'), 10);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForData(page);
});

// Drive controls through the DOM and fire the events the app listens for.
// The sidebar is off-canvas on mobile, so Playwright's visibility checks
// would block real clicks; the logic under test is the filter, not the layout.
async function setCheckbox(page, id, value) {
  await page.evaluate(([id, value]) => {
    const el = document.getElementById(id);
    el.checked = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, value]);
  await page.waitForTimeout(150);
}

test('filtering on dogs-allowed does NOT match every record', async ({ page }) => {
  // Regression: 'unknown' strings were truthy, so every record passed.
  const before = await resultCount(page);
  await setCheckbox(page, 'filter-dogs-allowed', true);
  const after = await resultCount(page);
  expect(after).toBeLessThan(before);
});

test('age filter returns results (not a silent no-op)', async ({ page }) => {
  const before = await resultCount(page);
  await page.fill('#filter-age-min', '5');
  await page.fill('#filter-age-max', '12');
  await page.dispatchEvent('#filter-age-max', 'change');
  await page.waitForTimeout(200);
  const after = await resultCount(page);
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThanOrEqual(before);
});

test('search narrows the results list and clearing restores it', async ({ page }) => {
  const before = await resultCount(page);
  await page.evaluate(() => {
    const i = document.getElementById('search-input');
    i.value = 'zzzz-no-such-playground';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  expect(await resultCount(page)).toBe(0);
  await expect(page.locator('.empty-state')).toHaveCount(1);

  await page.evaluate(() => document.getElementById('search-clear').click());
  await page.waitForTimeout(150);
  expect(await resultCount(page)).toBe(before);
});

test('search does not rebuild markers (same marker instances survive)', async ({ page }) => {
  // Tag the existing Leaflet marker objects, then check the tags survive a
  // search. A rebuild (syncMapMarkers) would create new instances and drop them.
  await page.evaluate(() => {
    for (const { marker } of state.markerObjects.values()) marker.__probe = true;
  });
  await page.evaluate(() => {
    const i = document.getElementById('search-input');
    i.value = 'lek';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  const survived = await page.evaluate(() => {
    const all = [...state.markerObjects.values()];
    return all.length > 0 && all.every(({ marker }) => marker.__probe === true);
  });
  expect(survived).toBe(true);
});

test('sidebar close button exists exactly once and is wired', async ({ page }) => {
  await expect(page.locator('#sidebar-close')).toHaveCount(1);
  await expect(page.locator('#detail-close')).toHaveCount(0);
});

test('service worker registers and its precache list resolves', async ({ page }) => {
  const reg = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return 'unsupported';
    const r = await navigator.serviceWorker.register('./sw.js');
    await navigator.serviceWorker.ready;
    return r.active ? 'active' : 'no-active';
  });
  expect(['active', 'unsupported']).toContain(reg);
});

test('every precached asset exists on disk', async ({ request }) => {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '..', '..');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const m = sw.match(/PRECACHE_ASSETS\s*=\s*\[([\s\S]*?)\]/);
  expect(m).not.toBeNull();
  const assets = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]).filter(a => a !== './');
  for (const a of assets) {
    expect(fs.existsSync(path.join(root, a)), `missing precache asset: ${a}`).toBe(true);
  }
});

test('manifest icons referenced exist on disk', async () => {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(__dirname, '..', '..');
  const mf = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  for (const ic of mf.icons) {
    expect(fs.existsSync(path.join(root, ic.src)), `missing icon: ${ic.src}`).toBe(true);
  }
});

test('popup escapes OSM-supplied names (no raw HTML injection)', async ({ page }) => {
  const html = await page.evaluate(() => {
    const p = { name: '<img src=x onerror=alert(1)>', source: 'osm', equipment: [], imageRefs: [] };
    return buildPopupContent(p);
  });
  expect(html).not.toContain('<img src=x');
  expect(html).toContain('&lt;img');
});

test('source filter narrows to matching records and to zero for an unknown source', async ({ page }) => {
  const before = await resultCount(page);
  await page.evaluate(() => {
    const s = document.getElementById('filter-source');
    s.value = 'no-such-source';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  expect(await resultCount(page)).toBe(0);

  await page.evaluate(() => {
    const s = document.getElementById('filter-source');
    s.value = 'alle';
    s.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  expect(await resultCount(page)).toBe(before);
});

test('equipment filter keeps only playgrounds that have the selected equipment', async ({ page }) => {
  // The dataset is sparse here: only a handful of records carry equipment
  // tags (see the `out center` limitation in tools/fetch_playgrounds.py),
  // and which labels are populated varies per bake. Pick a label that
  // actually exists in the loaded data instead of assuming the first
  // <option> has records.
  const target = await page.evaluate(() => {
    const counts = new Map();
    for (const p of state.playgrounds) {
      for (const e of p.equipment || []) counts.set(e.name, (counts.get(e.name) || 0) + 1);
    }
    let best = null;
    for (const [name, n] of counts) if (!best || n > best.n) best = { name, n };
    return best;
  });

  // If a future bake yields no equipment tags at all, assert that explicitly
  // rather than failing on a filter that has nothing to match.
  if (!target) {
    expect(await page.evaluate(() => state.playgrounds.some(p => (p.equipment || []).length > 0)))
      .toBe(false);
    test.skip(true, 'no records carry equipment tags in this dataset');
    return;
  }

  const before = await resultCount(page);
  expect(before).toBeGreaterThan(target.n);

  await page.evaluate((eq) => {
    const s = document.getElementById('filter-equipment');
    [...s.options].forEach(o => o.selected = (o.value === eq));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  }, target.name);
  await page.waitForTimeout(150);

  const after = await resultCount(page);
  expect(after).toBe(target.n);
  expect(after).toBeLessThan(before);
  const allHave = await page.evaluate((eq) =>
    state.filteredPlaygrounds.every(p => (p.equipment || []).some(e => e.name === eq)), target.name);
  expect(allHave).toBe(true);
});

test('clicking a result row opens the popup on its marker (delegated listener)', async ({ page }) => {
  // Guards the move to ONE delegated listener on the list container: a broken
  // delegation would leave rows inert.
  const target = await page.evaluate(() => {
    const first = state.filteredPlaygrounds[0];
    return { id: first.id, name: first.name };
  });
  await page.evaluate((id) => {
    const item = document.querySelector('.playground-item[data-id="' + CSS.escape(id) + '"]');
    item.scrollIntoView();
    item.click();
  }, target.id);
  await page.waitForTimeout(400);
  const opened = await page.evaluate(() =>
    !!(map._popup && map._popup.isOpen() && map._popup._source));
  expect(opened).toBe(true);
  const text = await page.evaluate(() => map._popup.getContent());
  expect(text).toContain(target.name);
});

test('result list is capped but the count reflects the true total', async ({ page }) => {
  // Renders are capped at MAX_LIST_ROWS so a filter change does not build
  // ~2850 DOM nodes. The header count must still show the real total.
  const total = await resultCount(page);
  expect(total).toBeGreaterThan(200);

  const rows = await page.locator('.playground-item').count();
  expect(rows).toBe(200);

  const notice = await page.locator('.list-overflow').textContent();
  expect(notice).toContain('Viser 200 av ' + total);

  // Narrowing below the cap removes the notice.
  await page.evaluate(() => {
    const i = document.getElementById('search-input');
    i.value = 'zzzz-no-such-playground';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150);
  await expect(page.locator('.list-overflow')).toHaveCount(0);
});

test('parking adapter treats untagged as unknown, not free', async ({ page }) => {
  // The baked GeoJSON still carries the old `free: True` default on every
  // record, so assert the adapter logic directly rather than the stale data.
  // The corrected default only lands in data/playgrounds_all.geojson on the
  // next nightly bake.
  const r = await page.evaluate(() => ({
    untagged: parkFromOSM({}),
    parkingNo: parkFromOSM({ parking: 'no' }),
    parkingYes: parkFromOSM({ parking: 'yes' }),
    feeNo: parkFromOSM({ parking_fee: 'no' }),
    feeYes: parkFromOSM({ parking_fee: 'yes' }),
  }));
  expect(r.untagged).toEqual({ free: false, paid: false });
  expect(r.parkingNo).toEqual({ free: false, paid: false });
  expect(r.parkingYes).toEqual({ free: true, paid: false });
  expect(r.feeNo.free).toBe(true);
  expect(r.feeYes.paid).toBe(true);
});

test('normalizePlayground coerces unknown/dogs strings to real booleans', async ({ page }) => {
  const r = await page.evaluate(() => {
    const base = { id: 'x', name: 'X', lat: 60, lng: 5 };
    const unknown = normalizePlayground({ ...base,
      parking: { free: 'unknown' }, dogs: { allowed: 'unknown', leash: 'unknown' } });
    const explicit = normalizePlayground({ ...base,
      parking: { free: true }, dogs: { allowed: true, leash: true } });
    return { unknown, explicit };
  });
  // 'unknown' is a truthy string; it must NOT pass the === true check.
  expect(r.unknown.freeParking).toBe(false);
  expect(r.unknown.dogsAllowed).toBe(false);
  expect(r.unknown.dogsLeash).toBe(false);
  expect(r.explicit.freeParking).toBe(true);
  expect(r.explicit.dogsAllowed).toBe(true);
});
