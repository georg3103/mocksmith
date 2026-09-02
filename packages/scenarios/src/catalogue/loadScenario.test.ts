import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadScenario } from './loadScenario';

const fixture = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/sample.scenario.ts'
);

describe('loadScenario', () => {
  /**
   * The loader is an argument so a plugin or a CLI command can resolve paths
   * from the user's config — but it has a default, and a caller with no context
   * (a script, this test) relies on it. Making it required broke the basic
   * example's smoke script, which is why it is pinned here.
   * */
  test('loads a TypeScript scenario with no loader supplied', async () => {
    await expect(loadScenario(fixture)).resolves.toMatchObject({
      name: 'Sample',
      endpoints: [{ path: '/api/items', status: 503 }],
    });
  });

  test('uses the loader it is given', async () => {
    const seen: string[] = [];

    await loadScenario('./anywhere.scenario.ts', async (specifier) => {
      seen.push(specifier);

      return { default: { endpoints: [] } };
    });

    expect(seen).toEqual(['./anywhere.scenario.ts']);
  });

  test('refuses a file that is not a module', async () => {
    await expect(loadScenario('./scenarios.json')).rejects.toThrow(/only \*\.scenario/);
  });
});
