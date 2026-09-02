import type { MockContext } from 'mocksmith';
import type { IncomingMessage } from 'node:http';
import type WebSocket from 'ws';

/**
 * The socket belongs to the same session as the REST calls, which is what lets
 * an HTTP handler push into it (see `sendToWebSocket` in handlers.ts).
 *
 * This handler only answers the client's own frames: `ping` proves the round
 * trip is alive, anything else comes back as an echo. Returning the context
 * keeps the connection bound to this session.
 * */
const handler = (context: MockContext, _request: IncomingMessage, data: unknown, ws: WebSocket) => {
  const message = String(data);

  ws.send(
    message === 'ping'
      ? JSON.stringify({ type: 'pong', at: new Date().toISOString() })
      : JSON.stringify({ type: 'echo', payload: message })
  );

  return context;
};

export default [{ path: '/ws', handler }];
