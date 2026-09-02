import type { MockContext } from 'mocksmith';
import type { IncomingMessage } from 'node:http';
import type WebSocket from 'ws';

import type { ChatApi } from './types';

/** How long a "typing" notice stands before the server withdraws it. */
const TYPING_TTL = 3000;

/**
 * Pushes a frame to every socket of this session — the same thing the third
 * argument of an HTTP handler does, written out here because a websocket
 * handler is handed the context instead.
 *
 * A string goes out as a text frame. A Buffer would arrive in the browser as a
 * Blob and make `JSON.parse(event.data)` fail, which is a mistake Node clients
 * never reveal.
 * */
const broadcast = (context: MockContext, payload: unknown, except?: unknown) => {
  const frame = JSON.stringify(payload);

  context
    .getWebsockets()
    .filter((socket) => socket !== except)
    .forEach((socket) => socket.send(frame));
};

/**
 * The notice goes to the *other* sockets of the session: the tab doing the
 * typing already knows. Two tabs of the demo therefore behave like two people.
 * */
const setTyping = (context: MockContext, names: string[], except?: unknown) => {
  const state = context.getApiData() as ChatApi;

  state.typing = names;
  broadcast(context, { type: 'typing', typing: names }, except);
};

/**
 * The socket belongs to the same session as the REST calls, which is what lets
 * an HTTP handler push into it (see `sendToWebSocket` in handlers.ts) and lets
 * this handler write to the world every other transport reads.
 *
 * Returning the context keeps the connection bound to this session.
 * */
const handler = (context: MockContext, _request: IncomingMessage, data: unknown, ws: WebSocket) => {
  const state = context.getApiData() as ChatApi;
  const raw = String(data);
  const message = raw.startsWith('{') ? (JSON.parse(raw) as { type?: string }) : { type: raw };

  if (message.type === 'hello') {
    ws.send(JSON.stringify({ type: 'welcome', members: state.members, at: new Date().toISOString() }));

    return context;
  }

  if (message.type === 'typing') {
    // The notice is stored in the session, so the SSE roster reports it too.
    setTyping(context, [state.me.name], ws);

    const previous = context.getData<ReturnType<typeof setTimeout>>('typing-timer');

    if (previous) {
      clearTimeout(previous);
    }

    const timer = setTimeout(() => setTyping(context, []), TYPING_TTL);

    timer.unref();
    context.setData('typing-timer', timer);

    return context;
  }

  ws.send(
    message.type === 'ping'
      ? JSON.stringify({ type: 'pong', at: new Date().toISOString() })
      : JSON.stringify({ type: 'echo', payload: raw })
  );

  return context;
};

export default [{ path: '/ws', handler }];
