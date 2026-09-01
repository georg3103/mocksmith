import { createJiti } from 'jiti';

const instances = new Map<string, ReturnType<typeof createJiti>>();

const getJiti = (parentUrl: string) => {
  let jiti = instances.get(parentUrl);

  if (!jiti) {
    jiti = createJiti(parentUrl, { interopDefault: false });
    instances.set(parentUrl, jiti);
  }

  return jiti;
};

/**
 * Imports a scenario file. Resolution starts from `parentUrl` so a path is read
 * relative to the user's project, and TypeScript works with no loader setup.
 * */
export const importModule = async (
  specifier: string,
  parentUrl: string = import.meta.url
): Promise<Record<string, unknown>> => {
  return (await getJiti(parentUrl).import(specifier)) as Record<string, unknown>;
};
