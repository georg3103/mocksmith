import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sessions } from '../context/session';
import { startMockerFromConfig } from './startMockerFromConfig';

import type { ResolvedMockerConfig } from './types';

const fixturesDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const resolvedFor = (config: Partial<ResolvedMockerConfig['config']>): ResolvedMockerConfig => ({
  config: { handlers: [{}], defaultSessionData: {}, ...config } as ResolvedMockerConfig['config'],
  configDirectory: fixturesDirectory,
  configPath: path.join(fixturesDirectory, 'mocksmith.config.ts'),
  serverUrl: 'http://127.0.0.1:0',
});

const startAndReadPort = async (
  config: Partial<ResolvedMockerConfig['config']>,
  options = {}
) => {
  const server = await startMockerFromConfig(resolvedFor(config), options);

  if (!server.listening) {
    await once(server, 'listening');
  }

  const { port } = server.address() as AddressInfo;

  server.close();
  await once(server, 'close');

  return port;
};

afterEach(() => {
  for (const id of sessions.listIds()) {
    sessions.clearSession(id);
  }

  sessions.setDefaultSessionId();
  delete process.env.MOCKSMITH_PORT;
  delete process.env.MOCKSMITH_HOST;
});

/**
 * The Vite plugin reserves a free port pair and hands it over through the
 * environment. That only works if the server actually reads it — otherwise the
 * healthcheck watches one port while the server listens on another.
 * */
describe('port resolution', () => {
  test('an explicit option wins over both the config and the environment', async () => {
    process.env.MOCKSMITH_PORT = '45311';

    const port = await startAndReadPort({ server: { host: '127.0.0.1', port: 45312 } }, { port: 0 });

    expect(port).not.toBe(45311);
    expect(port).not.toBe(45312);
  });

  test('the config wins over the environment', async () => {
    process.env.MOCKSMITH_PORT = '45313';

    const port = await startAndReadPort({ server: { host: '127.0.0.1', port: 0 } });

    expect(port).not.toBe(45313);
  });

  test('the environment fills in when the config names no port', async () => {
    // This is how the Vite plugin hands over the pair it reserved.
    process.env.MOCKSMITH_PORT = '45314';
    process.env.MOCKSMITH_HOST = '127.0.0.1';

    const port = await startAndReadPort({});

    expect(port).toBe(45314);
  });

  test('port 0 from the environment is honoured, not treated as unset', async () => {
    process.env.MOCKSMITH_PORT = '0';
    process.env.MOCKSMITH_HOST = '127.0.0.1';

    const port = await startAndReadPort({});

    expect(port).toBeGreaterThan(0);
    expect(port).not.toBe(3001);
  });
});
