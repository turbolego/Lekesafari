// Playwright config for Lekesafari e2e tests.
// Serves the repo root on a local static server so same-origin fetches
// (data/playgrounds_all.geojson) work exactly like GitHub Pages.
const { defineConfig } = require('@playwright/test');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 4173;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      args: ['--no-sandbox'],
    },
  },
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory "${ROOT}"`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
