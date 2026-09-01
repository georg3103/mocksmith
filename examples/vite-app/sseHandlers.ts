import type { SseHandler } from 'mocksmith';

const ticks: SseHandler = {
  path: '/sse/ticks',
  handler: (_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    let tick = 0;
    const timer = setInterval(() => {
      tick += 1;
      res.write(`data: ${JSON.stringify({ tick })}\n\n`);
    }, 200);

    res.on('close', () => clearInterval(timer));
  },
};

export default [ticks];
