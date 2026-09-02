import type { SseHandler } from 'mocksmith';

import type { ChatApi } from './types';

/**
 * A server-sent roster: an ordinary HTTP response that is never closed, with
 * one `data:` line per beat. It reads the same session as everything else, so
 * anything that changes the world — a message posted in the page, a
 * `mocksmith session set`, an applied scenario, a line from the TCP bot —
 * shows up here on the next beat, with no request from the browser.
 * */
const presence: SseHandler = {
  path: '/sse/presence',
  handler: (_req, res, context) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const send = () => {
      const { members, rooms, typing } = context.getApiData() as ChatApi;

      res.write(
        `data: ${JSON.stringify({
          members,
          typing,
          unread: rooms.reduce((total, room) => total + room.unread, 0),
          at: new Date().toISOString(),
        })}\n\n`
      );
    };

    send();

    const timer = setInterval(send, 1000);

    res.on('close', () => clearInterval(timer));
  },
};

export default [presence];
