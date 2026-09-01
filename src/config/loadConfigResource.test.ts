import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfigResource } from './loadConfigResource';
import { configResourceValidation } from './resourceValidators';

const fixturesDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures'
);

describe('loadConfigResource', () => {
  test('rejects an invalid handlers resource loaded from JSON', async () => {
    await expect(
      loadConfigResource(
        fixturesDirectory,
        'invalid-handlers.json',
        'handlers[0]',
        configResourceValidation.validators.handlers
      )
    ).rejects.toThrow('handlers[0] has an invalid structure');
  });
});
