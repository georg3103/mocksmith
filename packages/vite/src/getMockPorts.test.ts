import { getMockPortsEnv } from './getMockPorts';

const withEnv = async (env: Record<string, string | undefined>, run: () => Promise<void>) => {
  const previous = { ...process.env };

  Object.assign(process.env, env);

  try {
    await run();
  } finally {
    process.env = previous;
  }
};

describe('getMockPortsEnv', () => {
  test('returns http URIs by default', async () => {
    // The mock server and the Vite dev server both speak plain HTTP unless TLS
    // is configured. An https URI here makes the healthcheck open a TLS
    // handshake against an HTTP port, which never succeeds — the dev server
    // then hangs until the 60s timeout.
    await withEnv({ CI: '1', PORT: '4000', MOCKSMITH_PORT: '4001' }, async () => {
      const env = await getMockPortsEnv();

      expect(env.MOCKSMITH_URI).toBe('http://localhost:4001');
      expect(env.MOCKSMITH_APP_URI).toBe('http://localhost:4000');
    });
  });

  test('honours an explicit protocol and host', async () => {
    await withEnv({ CI: '1', PORT: '4000', MOCKSMITH_PORT: '4001' }, async () => {
      const env = await getMockPortsEnv({ protocol: 'https', host: '127.0.0.1' });

      expect(env.MOCKSMITH_URI).toBe('https://127.0.0.1:4001');
    });
  });

  test('passes the preferred ports through under CI', async () => {
    await withEnv({ CI: '1', PORT: '4100', MOCKSMITH_PORT: '4101' }, async () => {
      const env = await getMockPortsEnv();

      expect(env.PORT).toBe('4100');
      expect(env.MOCKSMITH_PORT).toBe('4101');
    });
  });

  test('marks the environment as resolved with a namespaced flag', async () => {
    await withEnv({ CI: '1' }, async () => {
      const env = await getMockPortsEnv();

      expect(env.MOCKSMITH_PORTS_RESOLVED).toBe('true');
      expect(env.MOCK_PORTS_RESOLVED).toBeUndefined();
    });
  });

  test('does not re-detect ports once resolved', async () => {
    await withEnv(
      { CI: undefined, MOCKSMITH_PORTS_RESOLVED: 'true', PORT: '4200', MOCKSMITH_PORT: '4201' },
      async () => {
        const env = await getMockPortsEnv();

        expect(env.PORT).toBe('4200');
        expect(env.MOCKSMITH_PORT).toBe('4201');
      }
    );
  });

  test('derives the backend port from the app port', async () => {
    await withEnv(
      { CI: '1', PORT: '5173', MOCKSMITH_PORT: undefined, MOCKSMITH_URI: undefined },
      async () => {
        const env = await getMockPortsEnv();

        expect(env.MOCKSMITH_PORT).toBe('5174');
      }
    );
  });
});
