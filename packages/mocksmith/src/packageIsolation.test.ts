import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const manifest = JSON.parse(
  readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
) as Record<string, Record<string, string> | undefined>;

/**
 * The promise this project makes: install the core and you get the core.
 * Scenarios, the Playwright fixture, the Vite plugins and the lint rule are
 * separate packages you opt into — so the core must never depend on them, in
 * any dependency field, however indirectly.
 * */
describe('core package isolation', () => {
  test.each(['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies'])(
    'declares no @mocksmith/* package in %s',
    (field) => {
      const names = Object.keys(manifest[field] ?? {}).filter((name) =>
        name.startsWith('@mocksmith/')
      );

      expect(names).toEqual([]);
    }
  );

  test('the source never imports a companion package', () => {
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
          if (/from '@mocksmith\//.test(readFileSync(full, 'utf8'))) {
            offenders.push(path.relative(packageRoot, full));
          }
        }
      }
    };

    walk(path.join(packageRoot, 'src'));

    expect(offenders).toEqual([]);
  });
});
