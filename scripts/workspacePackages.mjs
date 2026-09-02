/**
 * The publishable packages of the workspace, read from disk rather than
 * hardcoded — adding a package under `packages/` is then enough to include it
 * in a release.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const workspacePackages = (root) => {
  const packagesDirectory = path.join(root, 'packages');

  return readdirSync(packagesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifestPath = path.join(packagesDirectory, entry.name, 'package.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

      return { directory: entry.name, manifest, manifestPath };
    })
    .filter(({ manifest }) => !manifest.private);
};
