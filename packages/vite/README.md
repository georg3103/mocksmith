# @mocksmith/vite

Vite plugins for [mocksmith](https://github.com/georg3103/mocksmith): start the
mock server alongside the dev server, reload the browser on demand, and hand out
collision-free ports to parallel dev sessions.

```bash
npm install --save-dev @mocksmith/vite
```

```ts
import { defineConfig } from 'vite';
import { getMockPortsEnv, mockReloadPlugin, startProcessAndWaitPlugin } from '@mocksmith/vite';

const env = await getMockPortsEnv();

export default defineConfig({
  server: { port: Number(env.PORT) },
  plugins: [
    startProcessAndWaitPlugin({
      name: 'mocksmith',
      command: 'npx',
      args: ['mocksmith', 'start', '--config', './mocksmith.config.ts'],
      healthcheckUrl: `${env.MOCKSMITH_URI}/__healthcheck`,
      env,
    }),
    mockReloadPlugin(),
  ],
});
```

`startProcessAndWaitPlugin` waits for the healthcheck before Vite serves
anything, and stops the process when the dev server closes.

## License

MIT
