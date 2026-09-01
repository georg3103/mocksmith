/**
 * Installs the packed workspace packages an example actually declares — and
 * only those.
 *
 * That restriction is the point: if the core ever grew a hidden dependency on a
 * companion package, the core-only example would fail to resolve it here rather
 * than quietly passing because a sibling install had hoisted it into place.
 *
 * Usage: node scripts/install-tarballs.mjs <tarball-directory>
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [tarballDirectory] = process.argv.slice(2);

if (!tarballDirectory) {
  console.error('Usage: node scripts/install-tarballs.mjs <tarball-directory>');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const declared = Object.keys(manifest.dependencies ?? {});
const tarballs = readdirSync(tarballDirectory).filter((name) => name.endsWith('.tgz'));

/** `@mocksmith/scenarios` packs as `mocksmith-scenarios-0.2.0.tgz`. */
const tarballFor = (packageName) => {
  const flat = packageName.replace('@', '').replace('/', '-');

  return tarballs.find((name) => name.startsWith(`${flat}-`));
};

const wanted = declared
  .filter((name) => name === 'mocksmith' || name.startsWith('@mocksmith/'))
  .map((name) => {
    const tarball = tarballFor(name);

    if (!tarball) {
      console.error(`No tarball found for ${name} in ${tarballDirectory}`);
      process.exit(1);
    }

    return path.join(tarballDirectory, tarball);
  });

const rest = declared.filter((name) => name !== 'mocksmith' && !name.startsWith('@mocksmith/'));

console.log(`Installing ${wanted.length} local package(s) plus ${rest.length} dependency(-ies)`);

execFileSync('npm', ['install', '--no-package-lock', ...wanted, ...rest], { stdio: 'inherit' });
