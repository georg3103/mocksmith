import { EventEmitter } from 'events';
import { vi } from 'vitest';
import WebSocket from 'ws';

import { MockContext } from './context/context';
import { sessions } from './context/session';
import { systemHandlers } from './systemHandlers';

import type { MockFunction } from './types';

class FakeWebSocket extends EventEmitter {
  public readyState: WebSocket['readyState'] = WebSocket.OPEN;

  public close = vi.fn((code?: number, reason?: string) => {
    this.readyState = WebSocket.CLOSED;
    this.emit('close', code ?? 1000, Buffer.from(reason ?? ''));
  });

  public send = vi.fn((_chunk: Buffer, callback?: (error?: Error) => void) => {
    callback?.();
  });
}

const invokeSystemHandler = async (path: string, body: object) => {
  const handler = (systemHandlers as unknown as Record<string, MockFunction>)[path];

  expect(handler).toBeDefined();

  return handler(
    {},
    {
      context: new MockContext({}),
      name: path,
      request: {} as never,
      requestData: {
        body,
        path,
        query: {},
      },
    },
    () => false
  );
};

describe('system websocket handlers', () => {
  const sessionId = 'system-websocket-test';

  afterEach(() => {
    sessions.clearSession(sessionId);
  });

  it('returns websocket diagnostics for the selected session', async () => {
    sessions.createSession({}, sessionId);

    const context = sessions.getById(sessionId);

    context?.registerWebsocket('/core/mockfe3/', new FakeWebSocket() as unknown as WebSocket);

    await expect(
      invokeSystemHandler('/__mocks/api/websockets/state', {
        id: sessionId,
        path: '/core/mockfe3/',
      })
    ).resolves.toEqual({
      response: {
        body: {
          connections: [
            expect.objectContaining({
              active: true,
              id: 1,
              path: '/core/mockfe3/',
            }),
          ],
          messages: [],
          paths: {
            '/core/mockfe3/': {
              active: 1,
              closed: 0,
              lastConnectionId: 1,
              total: 1,
            },
          },
        },
      },
    });
  });

  it('closes websocket connections of the selected session', async () => {
    sessions.createSession({}, sessionId);

    const context = sessions.getById(sessionId);
    const socket = new FakeWebSocket();

    context?.registerWebsocket('/core/mockfe3/', socket as unknown as WebSocket);

    await expect(
      invokeSystemHandler('/__mocks/api/websockets/close', {
        code: 4001,
        id: sessionId,
        path: '/core/mockfe3/',
        reason: 'test close',
      })
    ).resolves.toEqual({
      response: {
        body: {
          closed: 1,
        },
      },
    });
    expect(socket.close).toHaveBeenCalledWith(4001, 'test close');
  });

  it('pushes a message into the active websockets of the selected session', async () => {
    sessions.createSession({}, sessionId);

    const context = sessions.getById(sessionId);
    const socket = new FakeWebSocket();

    context?.registerWebsocket('/core/mockfe3/', socket as unknown as WebSocket);

    await expect(
      invokeSystemHandler('/__mocks/api/sendToWebsocket', {
        data: {
          data: {
            ClientMessageFlags: 6,
            IdLogin: 106801896,
            MessageId: 10007,
            Objects: [1218],
          },
          type: 'ClientMessageEntity',
        },
        id: sessionId,
        path: '/core/mockfe3/',
      })
    ).resolves.toEqual({
      response: {
        body: {
          sent: 1,
        },
      },
    });
    expect(socket.send).toHaveBeenCalledWith(expect.any(Buffer), expect.any(Function));
  });
});
