import { mockTest, readSessionId } from '@mocksmith/playwright';
import { applyScenario } from '@mocksmith/scenarios/playwright';
import { expect } from '@playwright/test';
import net from 'node:net';

import session from '../session';

const MOCK_URI = process.env.MOCKSMITH_URI ?? 'http://localhost:3201';
const RAW_PORT = Number(process.env.MOCKSMITH_RAW_PORT ?? 3202);

/**
 * The app is real: these assertions read the DOM, so they only pass if the
 * browser actually received the mocked data through the dev server proxy —
 * over HTTP, over the websocket, over SSE and, in one test below, over a plain
 * TCP socket.
 * */
mockTest('renders the mocked room and roster', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  await expect(page.getByTestId('me-name')).toHaveText('Ada');
  await expect(page.getByTestId('me-plan')).toHaveText('pro');
  await expect(page.getByTestId('room-title')).toHaveText('#general');
  await expect(page.getByTestId('message')).toHaveCount(10);
  await expect(page.getByTestId('member')).toHaveCount(3);

  // The log is the page's own evidence that all three transports ran.
  await expect(page.getByTestId('event-log')).toContainText('GET /api/rooms · 200');
  await expect(page.getByTestId('event-log')).toContainText('↓ pong');
  await expect(page.getByTestId('event-log')).toContainText('roster open');
});

mockTest('sends a message over HTTP', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  await page.getByTestId('composer-input').fill('Bank the coals');
  await page.getByTestId('composer-send').click();

  await expect(page.getByTestId('message-text').last()).toHaveText('Bank the coals');
  await expect(page.getByTestId('outgoing')).toHaveCount(0);
  await expect(page.getByTestId('http-detail')).toContainText('/outbox');
});

mockTest('the websocket keeps a second tab in step', async ({ context, page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  // Same browser context, so the same session cookie — and therefore the same
  // mocked world and the same open websockets.
  const other = await context.newPage();

  await other.goto('/');
  // A pong means this tab's own socket is open and answering.
  await expect(other.getByTestId('ws-detail')).toContainText('pong');

  await page.getByTestId('composer-input').fill('Second fire is lit');
  await page.getByTestId('composer-send').click();

  // No reload: the HTTP handler pushed the message into this session's sockets.
  await expect(other.getByTestId('message-text').last()).toHaveText('Second fire is lit');
  // The other tab made no request of its own — the frame arrived on its socket.
  await expect(other.getByTestId('event-log')).toContainText('↓ message');
  await expect(other.getByTestId('event-log')).not.toContainText('/outbox');

  await other.close();
});

mockTest('typing travels between tabs', async ({ context, page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  const other = await context.newPage();

  await other.goto('/');
  // A pong means this tab's own socket is open and answering.
  await expect(other.getByTestId('ws-detail')).toContainText('pong');

  await page.getByTestId('composer-input').fill('half a word');

  // The server withholds the notice from the tab that caused it.
  await expect(other.getByTestId('typing')).toContainText('Ada is typing');
  await expect(page.getByTestId('typing')).toHaveText('');

  await other.close();
});

mockTest('loads older history behind a cursor', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  await expect(page.getByTestId('message')).toHaveCount(10);
  await page.getByTestId('load-older').click();

  await expect(page.getByTestId('message')).toHaveCount(20);
  await expect(page.getByTestId('event-log')).toContainText('?before=');
});

mockTest('a scenario applied from the page breaks only the older pages', async ({
  page,
  initMockContext,
}) => {
  await initMockContext(session);
  await page.goto('/');

  await page.getByTestId('scenarios-open').click();
  await page.getByTestId('scenario-item').filter({ hasText: 'History gap' }).click();

  await expect(page.getByTestId('active-scenario')).toHaveText('History gap');
  await expect(page.getByTestId('active-overrides')).toContainText('1 override');

  // The rule matches on `?before=`, so opening the room still works…
  await expect(page.getByTestId('message')).toHaveCount(10);

  // …and only the walk backwards fails.
  await page.getByTestId('load-older').click();
  await expect(page.getByTestId('history-error')).toBeVisible();
  await expect(page.getByTestId('http-detail')).toContainText('503');

  // Clearing drops the override and reloads the room, so the error goes with it.
  await page.getByTestId('scenario-clear').click();
  await expect(page.getByTestId('active-scenario')).toHaveText('No scenario applied');
  await expect(page.getByTestId('history-error')).toHaveCount(0);
  await page.getByTestId('load-older').click();
  await expect(page.getByTestId('message')).toHaveCount(20);
});

mockTest('the neighbouring session never saw that scenario', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  await page.getByTestId('load-older').click();
  await expect(page.getByTestId('message')).toHaveCount(20);
});

mockTest('a broken outbox drops the connection, then fails', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await applyScenario(page, 'Broken send');
  await page.goto('/');

  await page.getByTestId('composer-input').fill('Anything at all');
  await page.getByTestId('composer-send').click();

  /**
   * First attempt: `abort` destroys the socket. The page is talking through
   * Vite's proxy, and the proxy answers a hung-up upstream with a 500 of its
   * own — so what the browser sees is a 500, not the `TypeError: Failed to
   * fetch` it would get from the mock server directly. Either way it is a
   * different branch from the 503 that follows.
   * */
  await expect(page.getByTestId('outgoing-failed')).toBeVisible();
  await expect(page.getByTestId('http-detail')).toContainText('500');

  // Every attempt after it is a plain 503 — the last response repeats.
  await page.getByTestId('outgoing-retry').click();
  await expect(page.getByTestId('http-detail')).toContainText('503');
  await expect(page.getByTestId('outgoing-failed')).toBeVisible();

  // The room itself is untouched: sending has a path of its own.
  await expect(page.getByTestId('message')).toHaveCount(10);
});

mockTest('the room talks back while Busy room is on', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');
  await expect(page.getByTestId('message')).toHaveCount(10);

  await page.getByTestId('scenarios-open').click();
  await page.getByTestId('scenario-item').filter({ hasText: 'Busy room' }).click();
  await page.getByTestId('scenarios-open').click();

  // Nothing is clicked from here on: the plugin appends the line to the session
  // and pushes it into this session's sockets. The count is a lower bound, not
  // an equality — the room keeps talking while the assertion runs.
  await expect
    .poll(() => page.getByTestId('message').count(), { timeout: 15_000 })
    .toBeGreaterThan(10);
  await expect(page.getByTestId('messages')).toContainText('latch is fitted');
  await expect(page.getByTestId('event-log')).toContainText('↓ message');

  // The scenario patched the session rather than overriding an endpoint, so
  // clearing overrides would not stop it — the switch writes to the world.
  await page.getByTestId('chatter-toggle').click();
  await expect(page.getByTestId('chatter-toggle')).toHaveText('turn on');

  const settled = await page.getByTestId('message').count();

  await page.waitForTimeout(3000);
  await expect(page.getByTestId('message')).toHaveCount(settled);
});

mockTest('a feature flag grows the UI', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  await expect(page.getByTestId('reaction-add')).toHaveCount(0);

  await page.getByTestId('scenarios-open').click();
  await page.getByTestId('scenario-item').filter({ hasText: 'Reactions beta' }).click();

  await expect(page.getByTestId('reaction-add').first()).toBeVisible();

  await page.getByTestId('reaction-add').first().click();
  await expect(page.getByTestId('reaction-chip').first()).toContainText('1');
});

mockTest('the bot plugin speaks into the open page', async ({ page, context, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');
  await expect(page.getByTestId('ws-detail')).toContainText('pong');

  const id = await readSessionId(context);

  // The plugin's own system route, exactly what `mocksmith bot say` calls.
  const response = await context.request.post(`${MOCK_URI}/__mocks/api/bot/say`, {
    data: { id, text: 'the anvil is hot' },
  });

  expect(response.ok()).toBe(true);

  // Nothing was clicked in the page: the frame arrived on the socket.
  await expect(page.getByTestId('message-text').last()).toHaveText('the anvil is hot');
});

mockTest('a plain TCP client writes into the same world', async ({
  page,
  context,
  initMockContext,
}) => {
  await initMockContext(session);
  await page.goto('/');
  await expect(page.getByTestId('ws-detail')).toContainText('pong');

  const id = await readSessionId(context);

  // No HTTP, no cookies: the session is named in a handshake line instead.
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host: 'localhost', port: RAW_PORT }, () => {
      socket.write(`SESSION ${id}\nSAY hello from plain TCP\n`);
    });

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      if (/^OK \d+/m.test(String(chunk))) {
        socket.end();
        resolve();
      }
    });
    socket.on('error', reject);
  });

  await expect(page.getByTestId('message-text').last()).toHaveText('hello from plain TCP');
});

mockTest('a dropped socket is noticed and reopened', async ({ page, context, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');
  await expect(page.getByTestId('ws-detail')).toContainText('pong');

  await page.getByTestId('drop-socket').click();

  await expect(page.getByTestId('event-log')).toContainText('connection lost');
  // It comes back on its own, and says so.
  await expect(page.getByTestId('event-log')).toContainText('reconnected', { timeout: 10_000 });

  const id = await readSessionId(context);
  const response = await context.request.post(`${MOCK_URI}/__mocks/api/bot/say`, {
    data: { id, text: 'still listening' },
  });

  expect(response.ok()).toBe(true);
  await expect(page.getByTestId('message-text').last()).toHaveText('still listening');
});

mockTest('sessions are isolated: a change here is invisible elsewhere', async ({
  page,
  initMockContext,
}) => {
  await initMockContext({ ...session, me: { id: 'u-ada', name: 'Grace', plan: 'free' } });
  await page.goto('/');

  await expect(page.getByTestId('me-name')).toHaveText('Grace');
  await expect(page.getByTestId('me-plan')).toHaveText('free');
});

mockTest('the neighbouring session still sees its own data', async ({ page, initMockContext }) => {
  await initMockContext(session);
  await page.goto('/');

  await expect(page.getByTestId('me-name')).toHaveText('Ada');
});
