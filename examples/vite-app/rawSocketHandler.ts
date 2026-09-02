import { sessions } from 'mocksmith';

import type { MockContext, SocketConnection } from 'mocksmith';
import type { IncomingMessage } from 'node:http';

import type { ChatApi, Message } from './types';

/**
 * A native client on a plain TCP socket, sharing the world with the browser.
 *
 * Raw connections carry no cookies, so the session cannot be read from the
 * request — the client names it in a handshake line instead, and returning that
 * context is what binds the connection to it. From then on the connection is
 * bookkept exactly like a websocket: diagnostics, `websockets/close` and the
 * session-death poll all see it.
 *
 * The protocol is one command per line:
 *
 *   SESSION <id>    bind to a session (omit to stay on the default one)
 *   SAY <text>      post a message into #general
 * */
const handler = (
  context: MockContext,
  _request: IncomingMessage,
  data: Buffer,
  connection: SocketConnection
) => {
  const lines = String(data)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let current = context;

  for (const line of lines) {
    const [command, ...rest] = line.split(' ');
    const argument = rest.join(' ');

    if (command.toUpperCase() === 'SESSION') {
      const session = sessions.getById(argument);

      if (!session) {
        connection.send(`ERR no session ${argument}\n`);
        continue;
      }

      current = session;
      connection.send(`OK session ${session.id}\n`);
      continue;
    }

    if (command.toUpperCase() === 'SAY') {
      if (!argument) {
        connection.send('ERR say what\n');
        continue;
      }

      const state = current.getApiData() as ChatApi;
      const message: Message = {
        at: new Date().toISOString(),
        authorId: 'u-bot',
        id:
          Object.values(state.messages)
            .flat()
            .reduce((max, item) => Math.max(max, item.id), 0) + 1,
        roomId: 'general',
        text: argument,
      };

      state.messages.general.push(message);

      // Only the browser sockets: this client speaks lines, not JSON frames.
      const frame = JSON.stringify({ type: 'message', message });

      current.getWebsockets('/ws').forEach((socket) => socket.send(frame));
      connection.send(`OK ${message.id}\n`);
      continue;
    }

    connection.send(`ERR unknown command ${command}\n`);
  }

  // Returning a context binds the connection to that session (once).
  return current;
};

export default handler;
