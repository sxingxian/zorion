import { defineConfig } from '@playwright/test';

// Browser tests run against the local demo: both sites, an in-memory database, made-up places.
// Build first (`npm run build`), then `npm run e2e`.
export const ADMIN_KEY = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 390, height: 844 },
    permissions: ['geolocation'],
    geolocation: { latitude: 1.3, longitude: 103.84 },
    trace: 'retain-on-failure',
    launchOptions: {
      // E2E_CHROME points at an installed Chrome; otherwise Playwright's own Chromium is used.
      executablePath: process.env.E2E_CHROME || undefined,
      // Map tiles come from outside free services. Tests never call them: the same result locally and on
      // GitHub, no load on those services, and the map falls back as it would if they were all down.
      args: [
        '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
        '--host-resolver-rules=MAP www.onemap.gov.sg ~NOTFOUND, MAP tiles.openfreemap.org ~NOTFOUND, MAP tiles.versatiles.org ~NOTFOUND, MAP *.maptoolkit.org ~NOTFOUND',
      ],
    },
  },
  webServer: {
    command: 'npm run demo',
    cwd: '..',
    url: 'http://localhost:5173',
    env: { DEMO_ADMIN_KEY: ADMIN_KEY },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
