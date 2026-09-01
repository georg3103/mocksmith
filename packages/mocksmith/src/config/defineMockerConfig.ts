import type { MockerConfig } from './types';

export const defineMockerConfig = <T extends MockerConfig>(config: T): T => {
  return config;
};
