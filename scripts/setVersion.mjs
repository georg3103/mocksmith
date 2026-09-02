/**
 * Writes one version into every manifest of the workspace.
 *
 * The packages are released in lockstep: `mocksmith` and each `@mocksmith/*`
 * always carry the same version, so a user never has to reason about which
 * companion matches which core. semantic-release works out that version from
 * the commit history and calls this script in its `prepare` step.
 *
 * Internal references stay on the `workspace:^` protocol — `pnpm pack` rewrites
 * them into real ranges against these versions when the tarballs are built, so
 * there is nothing to substitute here.
 *
 * Usage: node scripts/setVersion.mjs <version>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { workspacePackages } from './workspacePackages.mjs';

const [version] = process.argv.slice(2);

if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version ?? '')) {
  console.error('Usage: node scripts/setVersion.mjs <version>');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const setVersion = (manifestPath) => {
  const source = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(source);
  const previous = manifest.version;

  manifest.version = version;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`${manifest.name}: ${previous ?? '—'} → ${version}`);
};

setVersion(path.join(root, 'package.json'));

for (const { manifestPath } of workspacePackages(root)) {
  setVersion(manifestPath);
}
