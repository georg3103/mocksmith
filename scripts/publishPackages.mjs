/**
 * Publishes every workspace package at the version already written into the
 * manifests by `scripts/setVersion.mjs`.
 *
 * Two tools, on purpose:
 *
 * - **pnpm packs.** Internal references use the `workspace:^` protocol, and
 *   only pnpm rewrites it into a real range while building the tarball. `npm
 *   pack` would ship `workspace:^` verbatim and every install would fail.
 * - **npm publishes.** Authentication is npm's trusted publishing: the npm CLI
 *   exchanges GitHub's OIDC token for a short-lived registry token, so no
 *   NPM_TOKEN is stored anywhere. pnpm cannot do that exchange, but it does not
 *   need to — the tarball it produced is what gets published.
 *
 * Pass --dry-run (or set RELEASE_DRY_RUN=true) to run the whole path without
 * touching the registry.
 *
 * Pass --otp <code> (or set NPM_OTP) when the account has two-factor
 * authentication on publish. A code expires in about thirty seconds, so a run
 * can outlive it — which is why an already-published version is skipped rather
 * than treated as a conflict, and the whole command can simply be repeated with
 * a fresh code until every package is up.
 *
 * Usage: node scripts/publishPackages.mjs [--dry-run] [--otp <code>]
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { workspacePackages } from './workspacePackages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dryRun = process.argv.includes('--dry-run') || process.env.RELEASE_DRY_RUN === 'true';
const otpFlag = process.argv.indexOf('--otp');
const otp = otpFlag === -1 ? process.env.NPM_OTP : process.argv[otpFlag + 1];

const run = (command, args) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const packages = workspacePackages(root);
const mismatched = packages.filter(({ manifest }) => manifest.version !== version);

// The packages are released in lockstep; a stray version means setVersion did
// not run, and publishing that would put a broken range on the registry.
if (mismatched.length > 0) {
  console.error(
    `Expected every package at ${version}, found: ${mismatched
      .map(({ manifest }) => `${manifest.name}@${manifest.version}`)
      .join(', ')}`
  );
  process.exit(1);
}

const tarballDirectory = mkdtempSync(path.join(os.tmpdir(), 'mocksmith-release-'));

console.log(`Packing ${packages.length} package(s) at ${version}`);
run('pnpm', ['-r', '--filter', './packages/*', 'pack', '--pack-destination', tarballDirectory]);

const tarballs = readdirSync(tarballDirectory).filter((file) => file.endsWith('.tgz'));

if (tarballs.length !== packages.length) {
  console.error(`Packed ${tarballs.length} tarball(s) for ${packages.length} package(s)`);
  process.exit(1);
}

/** npm's tarball name for a package: the scope loses its @ and its slash. */
const tarballOf = ({ name }) => `${name.replace('@', '').replace('/', '-')}-${version}.tgz`;

const alreadyPublished = (name) => {
  try {
    const found = execFileSync('npm', ['view', `${name}@${version}`, 'version'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return found.trim() === version;
  } catch {
    // Not on the registry — npm exits non-zero for a missing package or version.
    return false;
  }
};

let published = 0;
let skipped = 0;

for (const { manifest } of packages) {
  if (!dryRun && alreadyPublished(manifest.name)) {
    console.log(`\n${manifest.name}@${version} is already on the registry — skipping`);
    skipped += 1;
    continue;
  }

  const args = ['publish', path.join(tarballDirectory, tarballOf(manifest)), '--access', 'public'];

  // Provenance is signed by the CI runner, so it only works inside Actions.
  if (process.env.CI) {
    args.push('--provenance');
  }

  if (otp) {
    args.push('--otp', otp);
  }

  if (dryRun) {
    args.push('--dry-run');
  }

  console.log(`\nnpm ${args.map((arg) => (arg === otp ? '******' : arg)).join(' ')}`);
  run('npm', args);
  published += 1;
}

console.log(
  `\n${dryRun ? 'Dry run complete' : 'Done'}: ${published} published, ${skipped} already there — ${version}`
);
