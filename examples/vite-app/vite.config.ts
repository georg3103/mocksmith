import { getMockPortsEnv, mockReloadPlugin, startProcessAndWaitPlugin } from '@mocksmith/vite';
import react from '@vitejs/plugin-react';
import net from 'node:net';
import { defineConfig } from 'vite';

// Reserves a free (app, mock server) port pair, so several dev sessions can run
// side by side. Under CI it passes the preferred ports through untouched.
const env = await getMockPortsEnv();

/**
 * The raw TCP listener needs a third port, which getMockPortsEnv does not
 * reserve. Asking the OS for an ephemeral one is good enough here: the window
 * between closing this probe and the mock server binding is small, and CI pins
 * the port explicitly anyway.
 * */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();

    server.once('error', reject);
    server.listen(0, () => {
      const { port } = server.address() as net.AddressInfo;

      server.close(() => resolve(port));
    });
  });

const rawPort = process.env.MOCKSMITH_RAW_PORT ?? String(await freePort());

export default defineConfig({
  // The ports are decided at startup, so the page cannot hardcode them — the
  // hints it prints need the real ones to be copy-pasteable.
  define: {
    'import.meta.env.VITE_MOCKSMITH_URI': JSON.stringify(env.MOCKSMITH_URI),
    'import.meta.env.VITE_MOCKSMITH_RAW_PORT': JSON.stringify(rawPort),
  },
  plugins: [
    react(),
    startProcessAndWaitPlugin({
      name: 'mocksmith',
      command: 'npx',
      args: [
        'mocksmith',
        'start',
        '--config',
        './mocksmith.config.ts',
        '--host',
        'localhost',
        '--port',
        env.MOCKSMITH_PORT,
      ],
      healthcheckUrl: `${env.MOCKSMITH_URI}/__healthcheck`,
      env: { ...env, MOCKSMITH_RAW_PORT: rawPort },
    }),
    mockReloadPlugin(),
  ],
  server: {
    port: Number(env.PORT),
    strictPort: true,
    // The app talks to the mock server through the dev server: same origin
    // means the session cookie travels, and no CORS is involved.
    proxy: {
      '/api': env.MOCKSMITH_URI,
      '/sse': env.MOCKSMITH_URI,
      '/ws': { target: env.MOCKSMITH_URI, ws: true },
      // The system API, so the page's own scenario menu can drive the server
      // the same way the CLI does.
      '/__mocks': env.MOCKSMITH_URI,
    },
  },
});
