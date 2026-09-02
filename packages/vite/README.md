# @mocksmith/vite

Vite plugins for [mocksmith](https://github.com/georg3103/mocksmith): start the
mock server alongside the dev server, reload the browser on demand, and hand out
collision-free ports to parallel dev sessions.

```bash
npm install --save-dev @mocksmith/vite
```

```ts
// vite.config.ts
import { getMockPortsEnv, mockReloadPlugin, startProcessAndWaitPlugin } from '@mocksmith/vite';
import { defineConfig } from 'vite';

const env = await getMockPortsEnv();

export default defineConfig({
  plugins: [
    startProcessAndWaitPlugin({
      name: 'mocksmith',
      command: 'npx',
      args: [
        'mocksmith', 'start',
        '--config', './mocksmith.config.ts',
        '--host', 'localhost',
        '--port', env.MOCKSMITH_PORT,
      ],
      healthcheckUrl: `${env.MOCKSMITH_URI}/__healthcheck`,
      env,
    }),
    mockReloadPlugin(),
  ],
  server: {
    port: Number(env.PORT),
    strictPort: true,
    // Same origin for the app and the mocks: the session cookie travels, and
    // no CORS is involved (the mock server sends no CORS headers).
    proxy: {
      '/api': env.MOCKSMITH_URI,
      '/sse': env.MOCKSMITH_URI,
      '/ws': { target: env.MOCKSMITH_URI, ws: true },
      // Only if the app drives the system API itself — a scenario menu, say.
      '/__mocks': env.MOCKSMITH_URI,
    },
  },
});
```

`startProcessAndWaitPlugin` waits for the healthcheck before Vite serves
anything, and stops the process when the dev server closes. `getMockPortsEnv`
reserves a free (app, mock) port pair so parallel dev sessions never collide; it
returns http URIs by default and takes `{ protocol, host }` when you serve TLS.

A full working setup lives in
[`examples/vite-app`](https://github.com/georg3103/mocksmith/tree/main/examples/vite-app).

## License

MIT
