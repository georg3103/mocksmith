import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    scenario: 'src/scenario/index.ts',
    config: 'src/config/index.ts',
    playwright: 'src/playwright/index.ts',
    vite: 'src/vite/index.ts',
    eslint: 'src/eslint/index.ts',
    cli: 'src/cli/index.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
  banner: ({ format }) => (format === 'esm' ? { js: '' } : {}),
  esbuildOptions(options) {
    options.banner = { js: '' };
  },
  async onSuccess() {
    const { chmod, readFile, writeFile } = await import('node:fs/promises');
    const cliPath = 'dist/cli.js';
    const content = await readFile(cliPath, 'utf8');

    if (!content.startsWith('#!')) {
      await writeFile(cliPath, `#!/usr/bin/env node\n${content}`);
    }

    await chmod(cliPath, 0o755);
  },
});
