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
 * Imports a user module (config, handlers, scenario, plugin).
 *
 * `specifier` may be an absolute path, a path relative to `parentUrl`, or a
 * package name. Resolution starts from `parentUrl` — pass the user's config
 * file for anything they wrote, otherwise a package name would be looked up
 * relative to mocksmith's own install and fail. TypeScript works throughout,
 * no loader registration needed.
 * */
export const importModule = async (
  specifier: string,
  parentUrl: string = import.meta.url
): Promise<Record<string, unknown>> => {
  return (await getJiti(parentUrl).import(specifier)) as Record<string, unknown>;
};
