import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { sessions } from './context/session';
import { createMockServer } from './createMockServer';

describe('createMockServer', () => {
  const sessionIds = ['default', 'expired-session'];

  afterEach(() => {
    sessionIds.forEach((id) => sessions.clearSession(id));
    sessions.setDefaultSessionId();
  });

  test('does not crash on an HTTP request with a deleted session while SSE is enabled', async () => {
    sessions.createSession({}, sessionIds[0]);
    sessions.createSession({}, sessionIds[1]);

    const server = createMockServer({
      handlers: {},
      host: '127.0.0.1',
      port: 0,
      protocol: 'http',
      sseHandlers: [
        {
          path: '/events',
          handler: (_req, res) => {
            res.end();
          },
        },
      ],
    });

    try {
      await once(server, 'listening');

      const port = (server.address() as AddressInfo).port;

      sessions.clearSession(sessionIds[1]);

      const response = await fetch(`http://127.0.0.1:${port}/endpoint`, {
        headers: { cookie: `_mock_context_id=${sessionIds[1]}` },
      });

      expect(response.status).toBe(401);
      expect(await response.text()).toBe('Session not found');

      const healthcheck = await fetch(`http://127.0.0.1:${port}/__healthcheck`);

      expect(healthcheck.status).toBe(200);
    } finally {
      server.close();
      await once(server, 'close');
    }
  });
});
