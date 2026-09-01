import { expect } from '@playwright/test';
import { mockTest } from '@mocksmith/playwright';
import { applyScenario } from '@mocksmith/scenarios/playwright';

import scenario from './degraded.scenario';
import session from './session';

/**
 * The fixture gives every test its own mock session, so these two tests can
 * run in parallel and still see different data. `MOCKSMITH_URI` must point at
 * the running mock server.
 * */
mockTest('serves session data', async ({ page, initMockContext }) => {
  await initMockContext(session);

  const profile = await page.request.get('/api/profile');

  expect(await profile.json()).toEqual({ name: 'Ada', plan: 'pro' });
});

mockTest('applies a scenario on top of the session', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await applyScenario(page, scenario);

  const first = await page.request.get('/api/items');
  const second = await page.request.get('/api/items');

  expect(first.status()).toBe(200);
  expect(second.status()).toBe(503);
});
