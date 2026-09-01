import { defineConfig } from 'tsup';

import { tsupBase } from '../../tsup.base';

export default defineConfig({ ...tsupBase, entry: { index: 'src/index.ts' } });
