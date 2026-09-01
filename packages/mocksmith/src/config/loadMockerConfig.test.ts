import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigResource } from './loadConfigResource';
import { loadMockerConfig } from './loadMockerConfig';
import { configResourceValidation } from './resourceValidators';

const fixturesDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures'
);

describe('loadMockerConfig', () => {
  test('loads a JSON config', async () => {
    const resolved = await loadMockerConfig(path.join(fixturesDirectory, 'mocksmith.config.json'));

    expect(resolved.config.client?.sessionId).toBe('json-session');
    expect(resolved.config.server).toEqual({
      host: '127.0.0.1',
      port: 3101,
      rawSockets: true,
      ssl: true,
    });
    expect(resolved.config.handlers).toEqual(['./handlers.json']);
    expect(resolved.serverUrl).toBe('https://127.0.0.1:3101');
  });

  test('loads a JavaScript config', async () => {
    const resolved = await loadMockerConfig(path.join(fixturesDirectory, 'mocksmith.config.mjs'));

    expect(resolved.config.client?.sessionId).toBe('js-session');
    expect(resolved.config.handlers[0]).toBeDefined();
    expect(resolved.config.server).toEqual({
      host: undefined,
      port: 3102,
      rawSockets: undefined,
      ssl: undefined,
    });
  });

  test('loads a TypeScript config, inline resources included', async () => {
    const resolved = await loadMockerConfig(path.join(fixturesDirectory, 'mocksmith.config.ts'));

    expect(resolved.config.client?.sessionId).toBe('ts-session');
    expect(resolved.config.handlers[0]).toBeDefined();
    expect(resolved.config.defaultSessionData).toMatchObject({
      remoteConfigFlags: { TS_CONFIG: true },
    });
    expect(resolved.config.server).toMatchObject({ port: 3103, rawSockets: true, ssl: true });
    expect(resolved.config.session?.cookieName).toBe('test-session');
    expect(resolved.config.session?.tokens).toEqual({
      access: 'test-access-token',
      refresh: 'test-refresh-token',
    });
    expect(resolved.config.rawSockets).toMatchObject({
      greetingHex: '0102',
      routes: [{ port: 3201, path: '/socket', secure: true }],
    });
  });

  test('builds an HTTPS serverUrl from server.ssl', async () => {
    const resolved = await loadMockerConfig(path.join(fixturesDirectory, 'mocksmith.config.json'));

    expect(resolved.serverUrl).toBe('https://127.0.0.1:3101');
  });

  test.each(['raw-sockets', 'ssl'])('validates server.%s as a boolean', async (field) => {
    await expect(
      loadMockerConfig(path.join(fixturesDirectory, `mocksmith.invalid-server-${field}.config.json`))
    ).rejects.toThrow(
      `server.${field === 'raw-sockets' ? 'rawSockets' : field} must be a boolean`
    );
  });

  test('rejects an unsupported extension', async () => {
    await expect(loadMockerConfig('mocksmith.config.yaml')).rejects.toThrow(
      'Unsupported config format'
    );
  });

  test('does not allow inline resources in a JSON config', async () => {
    await expect(
      loadMockerConfig(path.join(fixturesDirectory, 'mocksmith.inline.config.json'))
    ).rejects.toThrow('handlers[0] must be a non-empty path');
  });

  test('rejects an invalid handlers resource loaded from a module', async () => {
    const resolved = await loadMockerConfig(
      path.join(fixturesDirectory, 'mocksmith.invalid-resource.config.json')
    );
    const [handlerResource] = resolved.config.handlers;

    await expect(
      loadConfigResource(
        resolved.configDirectory,
        handlerResource as string,
        'handlers[0]',
        configResourceValidation.validators.handlers
      )
    ).rejects.toThrow('handlers[0] has an invalid structure');
  });
});
