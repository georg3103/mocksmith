import { mockTest } from '@mocksmith/playwright';
import { applyScenario } from '@mocksmith/scenarios/playwright';
import { expect } from '@playwright/test';

import session from '../session';

/**
 * The app is real: these assertions read the DOM, so they only pass if the
 * browser actually received the mocked data through the dev server proxy.
 * */
mockTest('renders the mocked session', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  await expect(page.getByTestId('profile-name')).toHaveText('Ada');
  await expect(page.getByTestId('profile-plan')).toHaveText('pro');
  await expect(page.getByTestId('item')).toHaveCount(3);
});

mockTest('a scenario changes what the page shows', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await applyScenario(page, 'Degraded shop');
  await page.goto('/');

  // The scenario downgrades the plan and answers /api/items with an empty list
  // first, then keeps failing.
  await expect(page.getByTestId('profile-plan')).toHaveText('free');
  await expect(page.getByTestId('items-empty')).toBeVisible();

  await page.getByTestId('reload-items').click();

  await expect(page.getByTestId('items-error')).toBeVisible();
  await expect(page.getByTestId('items-error')).toContainText('503');
});

mockTest('a scenario object works without the registry', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await applyScenario(page, {
    endpoints: [{ path: '/api/items', status: 500, body: { error: 'boom' } }],
  });
  await page.goto('/');

  await expect(page.getByTestId('items-error')).toContainText('500');
  // The profile is untouched: an override applies to one endpoint only.
  await expect(page.getByTestId('profile-plan')).toHaveText('pro');
});

mockTest('an HTTP handler pushes into the websocket', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  await expect(page.getByTestId('profile-name')).toBeVisible();
  await page.getByTestId('notify').click();

  await expect(page.getByTestId('notification')).toHaveText('Hello, Ada!');
});

mockTest('the SSE stream reaches the page', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  await expect(page.getByTestId('tick')).toContainText('tick');
});

mockTest('sessions are isolated: a patch here is invisible elsewhere', async ({
  page,
  initMockContext,
}) => {
  await initMockContext({ ...session, user: { name: 'Grace', plan: 'free' } });
  await page.goto('/');

  await expect(page.getByTestId('profile-name')).toHaveText('Grace');
});

mockTest('the neighbouring session still sees its own data', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  await expect(page.getByTestId('profile-name')).toHaveText('Ada');
});
