import type { Options } from 'tsup';

/** Shared build settings for every package in the workspace. */
export const tsupBase: Options = {
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
};
