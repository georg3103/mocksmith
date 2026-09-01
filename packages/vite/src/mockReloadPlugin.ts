import type { Plugin } from 'vite';

/**
 * Opens a local `POST /__mock_reload` endpoint that broadcasts an HMR
 * `full-reload` to connected clients. The Vite client performs the reload
 * itself, so no application code is involved. This is what `mocksmith reload`
 * (and `mocksmith scenario apply`) calls after changing mock state.
 * Dev-server only.
 * */
export function mockReloadPlugin(): Plugin {
  return {
    name: 'mocksmith-reload',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__mock_reload', (_req, res) => {
        server.ws.send({ type: 'full-reload' });
        res.statusCode = 204;
        res.end();
      });
    },
  };
}
