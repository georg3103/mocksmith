import { getMockPortsEnv, mockReloadPlugin, startProcessAndWaitPlugin } from '@mocksmith/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Reserves a free (app, mock server) port pair, so several dev sessions can run
// side by side. Under CI it passes the preferred ports through untouched.
const env = await getMockPortsEnv();

export default defineConfig({
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
      env,
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
    },
  },
});
