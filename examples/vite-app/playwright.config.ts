import { defineConfig } from '@playwright/test';

/**
 * Ports are pinned here rather than reserved dynamically: the fixture reads
 * MOCKSMITH_URI when its module is first imported, so the value has to be
 * known before any spec loads. Setting CI-style fixed ports also keeps
 * `webServer` and `baseURL` in agreement.
 * */
const APP_PORT = Number(process.env.PORT ?? 3200);
const MOCK_PORT = Number(process.env.MOCKSMITH_PORT ?? 3201);
/** The raw TCP listener; the spec that talks to it reads this variable too. */
const RAW_PORT = Number(process.env.MOCKSMITH_RAW_PORT ?? 3202);

const baseURL = `http://localhost:${APP_PORT}`;

process.env.PORT = String(APP_PORT);
process.env.MOCKSMITH_PORT = String(MOCK_PORT);
process.env.MOCKSMITH_RAW_PORT = String(RAW_PORT);
process.env.MOCKSMITH_URI = `http://localhost:${MOCK_PORT}`;
// Stops getMockPortsEnv from reserving a different pair inside the dev server.
process.env.MOCKSMITH_PORTS_RESOLVED = 'true';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    // Required: the mock session cookie is bound to this origin.
    baseURL,
    trace: 'retain-on-failure',
    // Uses the Chrome already on the machine, so the example needs no browser
    // download. CI installs chromium and overrides this with PLAYWRIGHT_CHANNEL.
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome',
  },
  webServer: {
    command: 'npx vite',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      PORT: String(APP_PORT),
      MOCKSMITH_PORT: String(MOCK_PORT),
      MOCKSMITH_RAW_PORT: String(RAW_PORT),
      MOCKSMITH_PORTS_RESOLVED: 'true',
    },
  },
});
