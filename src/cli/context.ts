import log from 'loglevel';

import { readApiResponse } from './readApiResponse';

import type { ResolvedMockerConfig } from '../config/types';

export type CliLogger = Pick<typeof log, 'debug' | 'info' | 'warn' | 'error'>;

/**
 * Everything a CLI command needs to talk to a running mock server. Commands —
 * including those contributed by plugins — receive this instead of reaching for
 * module-level state, which is what makes the command tree testable.
 * */
export type CliContext = {
  /** POSTs to a system endpoint of the running server: `patchSession`, `setOverride`, … */
  callApi<T = unknown>(endpoint: string, body: Record<string, unknown>): Promise<T>;
  /** Session the commands act on. */
  sessionId: string;
  /** Base URL of the mock server. Throws when it cannot be determined. */
  getBaseUrl(): string;
  /** App URL used by `reload`. */
  appUrl?: string;
  /** Asks the dev server to reload the open browser. */
  reloadApp(): Promise<void>;
  resolvedConfig?: ResolvedMockerConfig;
  sslEnabled: boolean;
  log: CliLogger;
};

export type CreateCliContextOptions = {
  baseUrl?: string;
  appUrl?: string;
  sessionId: string;
  resolvedConfig?: ResolvedMockerConfig;
  sslEnabled: boolean;
  logger?: CliLogger;
};

export const createCliContext = ({
  baseUrl,
  appUrl,
  sessionId,
  resolvedConfig,
  sslEnabled,
  logger = log,
}: CreateCliContextOptions): CliContext => {
  const getBaseUrl = () => {
    if (!baseUrl) {
      throw new Error('Provide --config <path>, --url <url> or MOCKSMITH_URI');
    }

    return baseUrl;
  };

  const callApi = async <T = unknown>(
    endpoint: string,
    body: Record<string, unknown>
  ): Promise<T> => {
    const serverUrl = getBaseUrl();
    const url = `${serverUrl}/__mocks/api/${endpoint}`;

    let res: Response;

    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      logger.error(`Could not reach the mock server at ${serverUrl}. Is it running (mocksmith start)?`);

      throw e;
    }

    return readApiResponse<T>(endpoint, res);
  };

  const reloadApp = async () => {
    if (!appUrl) {
      throw new Error('The reload command requires client.appUrl, --app-url or MOCKSMITH_APP_URI');
    }

    try {
      await fetch(`${appUrl}/__mock_reload`, { method: 'POST' });
    } catch (e) {
      logger.error(`Could not reach the app at ${appUrl}. Is the dev server running?`);

      throw e;
    }
  };

  return {
    callApi,
    sessionId,
    getBaseUrl,
    appUrl,
    reloadApp,
    resolvedConfig,
    sslEnabled,
    log: logger,
  };
};
