import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadMockerConfig } from './loadMockerConfig';

const fixturesDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * parseConfig rebuilds a fresh object literal rather than spreading the input,
 * so any field it does not explicitly copy is dropped without a word. That is a
 * silent data loss bug for every future config option, hence this guard.
 * */
describe('config round-trip', () => {
  test('keeps every field of a config that uses them all', async () => {
    const resolved = await loadMockerConfig(
      path.join(fixturesDirectory, 'mocksmith.full.config.mjs')
    );
    const { default: source } = (await import(
      path.join(fixturesDirectory, 'mocksmith.full.config.mjs')
    )) as { default: Record<string, unknown> };

    const lost = Object.keys(source).filter(
      (key) => (resolved.config as Record<string, unknown>)[key] === undefined
    );

    expect(lost, `parseConfig dropped: ${lost.join(', ')}`).toEqual([]);
  });

  test('preserves nested values, not just the keys', async () => {
    const resolved = await loadMockerConfig(
      path.join(fixturesDirectory, 'mocksmith.full.config.mjs')
    );

    expect(resolved.config.server).toMatchObject({ port: 3111, rawSockets: true, ssl: true });
    expect(resolved.config.session?.tokens).toEqual({
      access: 'full-access',
      refresh: 'full-refresh',
    });
    expect(resolved.config.websocket?.echoSubprotocols).toEqual(['full.native']);
    expect(resolved.config.rawSockets).toMatchObject({
      greetingHex: '0102',
      routes: [{ port: 3211, path: '/raw', secure: true }],
    });
    expect(resolved.config.defaultSessionId).toBe('full-session');
  });
});
