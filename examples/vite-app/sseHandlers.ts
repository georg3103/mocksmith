import type { SseHandler } from 'mocksmith';

import type { TodoApi } from './handlers';

/**
 * A server-sent stream of progress: an ordinary HTTP response that is never
 * closed, with one `data:` line per event. It reads the same session as the
 * REST handlers, so anything that changes the world — a click in the page, a
 * `mocksmith session set`, an applied scenario — shows up here on the next
 * beat, with no request from the browser.
 * */
const progress: SseHandler = {
  path: '/sse/progress',
  handler: (_req, res, context) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const send = () => {
      const { todos, user } = context.getApiData() as TodoApi;

      res.write(
        `data: ${JSON.stringify({
          done: todos.filter((todo) => todo.done).length,
          total: todos.length,
          plan: user.plan,
          at: new Date().toISOString(),
        })}\n\n`
      );
    };

    send();

    const timer = setInterval(send, 1000);

    res.on('close', () => clearInterval(timer));
  },
};

export default [progress];
