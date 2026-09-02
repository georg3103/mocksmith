#!/usr/bin/env node
/**
 * A launcher that is checked in, rather than built.
 *
 * Package managers create the `mocksmith` symlink while installing, and they
 * skip a bin whose file does not exist yet. Pointing `bin` straight at
 * `dist/cli.js` therefore worked for anyone installing a published tarball —
 * where dist is present — and silently failed inside this repository, where a
 * fresh clone is installed before it is built. The CLI then existed but could
 * not be invoked by name, which is exactly what broke the demo's dev server.
 *
 * This file always exists, so the link is always created, and what it points at
 * is allowed to appear later.
 */
try {
  await import('../dist/cli.js');
} catch (error) {
  if (error?.code === 'ERR_MODULE_NOT_FOUND') {
    process.stderr.write('mocksmith is not built yet — run `pnpm run build` in the repository root.\n');
    process.exit(1);
  }

  throw error;
}
