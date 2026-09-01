import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { interopDefault: false });

/**
 * Imports a user module (config, handlers, scenario) by absolute path.
 * Backed by jiti, so TypeScript files work without a registered loader.
 * */
export const importModule = async (absolutePath: string): Promise<Record<string, unknown>> => {
  return (await jiti.import(absolutePath)) as Record<string, unknown>;
};
