import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { importModule } from '../utils/importModule';
import { configResourceValidation } from './resourceValidators';

import type { ConfigResourceValidator } from './types';

const MODULE_EXTENSIONS = new Set(['.cjs', '.cts', '.js', '.mjs', '.mts', '.ts']);

const resolveConfigPath = (configDirectory: string, resourcePath: string) => {
  return path.resolve(configDirectory, resourcePath);
};

export const loadConfigResource = async <T>(
  configDirectory: string,
  resourcePath: string,
  field: string,
  validator: ConfigResourceValidator<T>
): Promise<T> => {
  const absolutePath = resolveConfigPath(configDirectory, resourcePath);
  const extension = path.extname(absolutePath);

  try {
    if (extension === '.json') {
      const value = JSON.parse(await readFile(absolutePath, 'utf8')) as unknown;

      return configResourceValidation.validate(value, field, validator);
    }

    if (!MODULE_EXTENSIONS.has(extension)) {
      throw new Error(`unsupported extension "${extension || 'none'}"`);
    }

    const module = await importModule(absolutePath);

    if (!('default' in module)) {
      throw new Error('the module must have a default export');
    }

    return configResourceValidation.validate(module.default, field, validator);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Failed to load ${field} from ${absolutePath}: ${message}`);
  }
};
