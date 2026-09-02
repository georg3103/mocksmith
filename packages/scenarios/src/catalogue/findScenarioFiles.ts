import { glob } from 'tinyglobby';

const EXTENSIONS = '{ts,mts,cts,js,mjs,cjs}';

const DEFAULT_EXCLUDE = ['**/node_modules/**', '**/dist/**'];

export type FindScenarioFilesOptions = {
  /** Globs for scenario files, relative to the config. */
  include?: string[];
  exclude?: string[];
  /** Shorthand for include: [`${dir}/**\/*.scenario.*`]. */
  dir?: string;
};

/**
 * Finds the scenario files under the config directory, sorted so the registry
 * is built in the same order on every machine.
 * */
export const findScenarioFiles = async (
  configDirectory: string,
  { include, exclude, dir }: FindScenarioFilesOptions = {}
): Promise<string[]> => {
  const patterns =
    include ??
    (dir ? [`${dir}/**/*.scenario.${EXTENSIONS}`] : [`**/*.scenario.${EXTENSIONS}`]);

  const files = await glob(patterns, {
    cwd: configDirectory,
    absolute: true,
    ignore: exclude ?? DEFAULT_EXCLUDE,
  });

  return files.sort();
};
