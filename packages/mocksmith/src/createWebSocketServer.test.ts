import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';

import { sessions } from './context/session';
import { createMockServer } from './createMockServer';

describe('createWebSocketServer session matching', () => {
  const sessionIds = ['default', 'websocket-target'];

  afterEach(() => {
    sessionIds.forEach((id) => sessions.clearSession(id));
    sessions.setDefaultSessionId();
  });

  test('uses the configured default session until the first message authenticates', async () => {
    sessions.setDefaultSessionId(sessionIds[1]);
    sessions.createSession({}, sessionIds[1]);

    const targetContext = sessions.getDefaultSession();

    if (!targetContext) {
      throw new Error('Test default session was not created');
    }

    let resolveHandlerCall: () => void = () => void 0;
    const handlerCalled = new Promise<void>((resolve) => {
      resolveHandlerCall = resolve;
    });
    const server = createMockServer({
      handlers: {},
      host: '127.0.0.1',
      port: 0,
      protocol: 'http',
      websockets: [
        {
          path: '/socket',
          sessionFromMessage: true,
          handler: (context: unknown) => {
            expect(context).toBe(targetContext);
            resolveHandlerCall();

            return targetContext;
          },
        },
      ],
    });

    await once(server, 'listening');

    const port = (server.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/socket`);

    await once(socket, 'open');
    socket.send(Buffer.from('auth'));
    await handlerCalled;

    socket.close();
    await once(socket, 'close');
    server.close();
    await once(server, 'close');
  });

  test('registers the websocket in the context resolved by the first message', async () => {
    sessions.createSession({}, sessionIds[0]);
    sessions.createSession({}, sessionIds[1]);

    const initialContext = sessions.getById(sessionIds[0]);
    const targetContext = sessions.getById(sessionIds[1]);

    if (!initialContext || !targetContext) {
      throw new Error('Test sessions were not created');
    }

    let resolveHandlerCall: () => void = () => void 0;
    const handlerCalled = new Promise<void>((resolve) => {
      resolveHandlerCall = resolve;
    });
    const server = createMockServer({
      handlers: {},
      host: '127.0.0.1',
      port: 0,
      protocol: 'http',
      websockets: [
        {
          path: '/socket',
          sessionFromMessage: true,
          handler: () => {
            resolveHandlerCall();

            return targetContext;
          },
        },
      ],
    });

    await once(server, 'listening');

    const port = (server.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/socket`, {
      headers: { cookie: '_mock_context_id=default' },
    });

    await once(socket, 'open');
    socket.send(Buffer.from('auth'));

    await handlerCalled;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(initialContext.getWebsocketDiagnostics('/socket').connections).toHaveLength(0);
    expect(targetContext.getWebsocketDiagnostics('/socket').connections).toHaveLength(1);

    socket.close();
    await once(socket, 'close');
    server.close();
    await once(server, 'close');
  });

  test('rejects an HTTP request with an unknown bearer instead of falling back to default', async () => {
    sessions.createSession({}, 'default');

    const server = createMockServer({
      handlers: {},
      host: '127.0.0.1',
      port: 0,
      protocol: 'http',
    });

    await once(server, 'listening');

    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/endpoint`, {
      headers: { authorization: 'Bearer unknown' },
    });

    expect(response.status).toBe(401);

    server.close();
    await once(server, 'close');
  });
});

describe('websocket upgrades without a matching route', () => {
  test('closes the socket instead of leaving the client hanging', async () => {
    sessions.createSession({}, 'default');

    const server = createMockServer({
      handlers: {},
      host: '127.0.0.1',
      port: 0,
      protocol: 'http',
      websockets: [{ path: '/known', sessionFromMessage: false, handler: () => undefined }],
    });

    await once(server, 'listening');

    const port = (server.address() as AddressInfo).port;
    const socket = new WebSocket(`ws://127.0.0.1:${port}/unknown`);
    const error = await Promise.race([
      once(socket, 'error').then(() => 'closed'),
      once(socket, 'open').then(() => 'opened'),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 2000)),
    ]);

    expect(error).toBe('closed');

    socket.close();
    server.close();
    await once(server, 'close');
  });
});
