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

/**
 * `@mocksmith/scenarios` packs as `mocksmith-scenarios-0.2.0.tgz`.
 *
 * The version has to be part of the match: a prefix alone would let the core
 * `mocksmith` pick up `mocksmith-vite-1.2.3.tgz`, whichever the directory
 * happened to list first.
 * */
const tarballFor = (packageName) => {
  const flat = packageName.replace('@', '').replace('/', '-');
  const pattern = new RegExp(`^${flat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d.*\\.tgz$`);

  return tarballs.find((name) => pattern.test(name));
};

const wanted = declared
  .filter((name) => name === 'mocksmith' || name.startsWith('@mocksmith/'))
  .map((name) => {
    const tarball = tarballFor(name);

    if (!tarball) {
      console.error(`No tarball found for ${name} in ${tarballDirectory}`);
      process.exit(1);
    }

    return { name, file: path.join(tarballDirectory, tarball) };
  });

const rest = declared.filter((name) => name !== 'mocksmith' && !name.startsWith('@mocksmith/'));

console.log(`Installing ${wanted.length} local package(s) plus ${rest.length} dependency(-ies)`);

const install = (specifiers) =>
  execFileSync('npm', ['install', '--no-package-lock', ...specifiers], { stdio: 'inherit' });

/**
 * The core goes in first, on its own.
 *
 * Every companion declares `mocksmith` as a peer dependency, and npm cannot
 * resolve a peer that is itself an unresolved tarball in the same command — it
 * fails deep inside its tree builder with "Cannot destructure property
 * 'package' of 'node.target' as it is null". Installing the core first gives
 * that peer something real to point at.
 * */
const core = wanted.find(({ name }) => name === 'mocksmith');
const companions = wanted.filter((entry) => entry !== core).map(({ file }) => file);

if (core) {
  install([core.file]);
}

if (companions.length > 0 || rest.length > 0) {
  install([...companions, ...rest]);
}
