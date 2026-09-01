import { match } from 'path-to-regexp';

export type HandlerKeyMatch = {
  key: string;
  params: Record<string, unknown>;
};

/**
 * Compiled matchers cached by key. `match()` rebuilds its regexp on every call,
 * and with hundreds of keys scanned per request that would mean hundreds of
 * compilations per response.
 * */
const matchers = new Map<string, ReturnType<typeof match>>();

function getMatcher(key: string) {
  let matcher = matchers.get(key);

  if (!matcher) {
    matcher = match(key);
    matchers.set(key, matcher);
  }

  return matcher;
}

/**
 * Finds the mock key matching a request path.
 * An exact match wins over a pattern: keys like `/api/items/previews` and
 * `/api/items/:id` both match the same path, and the exact one must win.
 * */
export function findHandlerKey(keys: string[], path: string): HandlerKeyMatch | undefined {
  if (keys.includes(path)) {
    return { key: path, params: {} };
  }

  for (const key of keys) {
    const result = getMatcher(key)(path);

    if (result) {
      return { key, params: result.params };
    }
  }

  return undefined;
}
