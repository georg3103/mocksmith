import type { MockContext } from 'mocksmith';
import type { IncomingMessage } from 'node:http';
import type WebSocket from 'ws';

/**
 * Echo handler: answers every incoming frame with the same payload wrapped in
 * an envelope. Returning the context keeps the socket bound to this session.
 * */
const echo = (context: MockContext, _request: IncomingMessage, data: unknown, ws: WebSocket) => {
  ws.send(JSON.stringify({ type: 'echo', payload: String(data) }));

  return context;
};

export default [{ path: '/ws', handler: echo }];
