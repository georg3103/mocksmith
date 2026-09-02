import { mockTest } from '@mocksmith/playwright';
import { applyScenario } from '@mocksmith/scenarios/playwright';
import { expect } from '@playwright/test';

import session from '../session';

/**
 * The app is real: these assertions read the DOM, so they only pass if the
 * browser actually received the mocked data through the dev server proxy —
 * over HTTP, over the websocket and over SSE.
 * */
mockTest('renders the mocked session', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  await expect(page.getByTestId('user-name')).toHaveText('Ada');
  await expect(page.getByTestId('user-plan')).toHaveText('pro');
  await expect(page.getByTestId('todo')).toHaveCount(3);
  await expect(page.getByTestId('tally')).toHaveText('2 of 3 left');

  // The log is the page's own evidence that all three transports ran.
  await expect(page.getByTestId('event-log')).toContainText('GET /api/board · 200');
  await expect(page.getByTestId('event-log')).toContainText('↓ pong');
  await expect(page.getByTestId('event-log')).toContainText('stream open');
});

mockTest('adds, toggles and deletes over HTTP', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  await page.getByTestId('new-todo').fill('Sharpen the tongs');
  await page.getByTestId('add-todo').click();

  await expect(page.getByTestId('todo')).toHaveCount(4);
  await expect(page.getByTestId('todo-title').last()).toHaveText('Sharpen the tongs');
  await expect(page.getByTestId('http-detail')).toContainText('POST /api/todos');

  // PATCH: the fourth item becomes done, so one fewer is left. The checkbox is
  // driven by the server's answer, so `click` + an assertion, not `check` —
  // `check` verifies the state before the round trip is over.
  await page.getByTestId('todo-toggle').last().click();
  await expect(page.getByTestId('todo-toggle').last()).toBeChecked();
  await expect(page.getByTestId('tally')).toHaveText('2 of 4 left');

  // DELETE: and it is gone.
  await page.getByTestId('todo-delete').last().click();
  await expect(page.getByTestId('todo')).toHaveCount(3);
});

mockTest('the websocket keeps a second tab in step', async ({
  context,
  page,
  initMockContext,
}) => {
  await initMockContext(session);
  await page.goto('/');

  // Same browser context, so the same session cookie — and therefore the same
  // mocked world and the same open websockets.
  const other = await context.newPage();

  await other.goto('/');
  await expect(other.getByTestId('transport-ws').getByTestId('ws-detail')).toContainText('pong');

  await page.getByTestId('new-todo').fill('Bank the coals');
  await page.getByTestId('add-todo').click();

  // No reload here: the HTTP handler pushed the new list into this session's
  // sockets, and the other tab applied it.
  await expect(other.getByTestId('todo')).toHaveCount(4);
  await expect(other.getByTestId('todo-title').last()).toHaveText('Bank the coals');
  // The second tab made no request of its own — the frame arrived on its socket.
  await expect(other.getByTestId('event-log')).toContainText('↓ todos');
  await expect(other.getByTestId('event-log')).not.toContainText('POST /api/todos');

  await other.close();
});

mockTest('the SSE stream reports progress from the same session', async ({
  page,
  initMockContext,
}) => {
  await initMockContext(session);
  await page.goto('/');

  await expect(page.getByTestId('sse-detail')).toContainText('1/3 done');

  await page.getByTestId('todo-toggle').last().click();

  // The stream reads the session itself, so a change made over HTTP shows up
  // on the next beat without the page asking for it.
  await expect(page.getByTestId('sse-detail')).toContainText('2/3 done');
});

mockTest('a scenario changes what the page shows', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await applyScenario(page, 'Flaky board');
  await page.goto('/');

  // First call: slow, empty, and the plan is downgraded by the session patch.
  await expect(page.getByTestId('user-plan')).toHaveText('free');
  await expect(page.getByTestId('board-empty')).toBeVisible();

  // Every call after it fails.
  await page.getByTestId('new-todo').fill('Anything');
  await page.getByTestId('add-todo').click();
  await expect(page.getByTestId('http-detail')).toContainText('503');
});

mockTest('an ad-hoc scenario object works without the registry', async ({
  page,
  initMockContext,
}) => {
  await initMockContext(session);
  await applyScenario(page, {
    endpoints: [{ path: '/api/board', status: 500, body: { error: 'boom' } }],
  });
  await page.goto('/');

  await expect(page.getByTestId('board-error')).toContainText('500');
});

mockTest('sessions are isolated: a change here is invisible elsewhere', async ({
  page,
  initMockContext,
}) => {
  await initMockContext({ ...session, user: { name: 'Grace', plan: 'free' } });
  await page.goto('/');

  await expect(page.getByTestId('user-name')).toHaveText('Grace');
});

mockTest('the neighbouring session still sees its own data', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  await expect(page.getByTestId('user-name')).toHaveText('Ada');
});
