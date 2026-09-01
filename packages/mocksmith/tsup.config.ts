import { defineConfig } from 'tsup';

import { tsupBase } from '../../tsup.base';

export default defineConfig({
  ...tsupBase,
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
    config: 'src/config/index.ts',
    plugin: 'src/plugin/index.ts',
    cli: 'src/cli/index.ts',
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
