import { Command } from 'commander';
import log from 'loglevel';

import { loadMockerConfig } from '../config/loadMockerConfig';
import { startMockerFromConfig } from '../config/startMockerFromConfig';
import { getMockEnv } from '../env';
import { applyScenarioViaApi } from '../scenario/applyScenarioViaApi';
import { loadScenario } from '../scenario/loadScenario';
import { cliEnvironment } from './env';
import { endpointOptionParsers } from './parseEndpointOptions';
import { readApiResponse } from './readApiResponse';

const readOption = (names: string[]) => {
  for (let index = 0; index < process.argv.length; index += 1) {
    const argument = process.argv[index];

    if (names.includes(argument)) {
      return process.argv[index + 1];
    }

    const name = names.find((item) => argument.startsWith(`${item}=`));

    if (name) {
      return argument.slice(name.length + 1);
    }
  }

  return undefined;
};

const normalizeLegacySubcommand = (
  commandName: string,
  subcommands: string[],
  defaultSubcommand: string
) => {
  const commandIndex = process.argv.indexOf(commandName);
  const nextArgument = process.argv[commandIndex + 1];

  if (
    commandIndex !== -1 &&
    nextArgument &&
    !nextArgument.startsWith('-') &&
    !subcommands.includes(nextArgument)
  ) {
    process.argv.splice(commandIndex + 1, 0, defaultSubcommand);
  }
};

normalizeLegacySubcommand('endpoint', ['clear', 'help', 'list', 'set'], 'set');
normalizeLegacySubcommand('scenario', ['apply', 'clear', 'help'], 'apply');

const configFile = readOption(['--config', '-c']) ?? cliEnvironment.configPath;
const resolvedConfig = configFile ? await loadMockerConfig(configFile) : undefined;
const sslEnabled = process.argv.includes('--ssl') || Boolean(resolvedConfig?.config.server?.ssl);
const configServerUrl = resolvedConfig?.serverUrl;
const baseUrl =
  readOption(['--url']) ??
  cliEnvironment.serverUrl ??
  resolvedConfig?.config.client?.url ??
  (sslEnabled && configServerUrl ? configServerUrl.replace(/^http:/, 'https:') : configServerUrl);
const appUrl =
  readOption(['--app-url']) ?? cliEnvironment.appUrl ?? resolvedConfig?.config.client?.appUrl;
const sessionId =
  readOption(['--session']) ??
  cliEnvironment.sessionId ??
  resolvedConfig?.config.client?.sessionId ??
  'default';

cliEnvironment.allowInsecureLocalTls();

process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (
    (w as Error & { code?: string }).code !== 'DEP0180' &&
    !/NODE_TLS_REJECT_UNAUTHORIZED/.test(w.message)
  ) {
    log.warn(w);
  }
});

log.setLevel(getMockEnv().logLevel);

type ApiData = Record<string, unknown>;

const getBaseUrl = () => {
  if (!baseUrl) {
    throw new Error('Provide --config <path>, --url <url> or MOCKSMITH_URI');
  }

  return baseUrl;
};

async function callApi<T = unknown>(endpoint: string, body: Record<string, unknown>): Promise<T> {
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
    log.error(
      `Could not reach the mock server at ${serverUrl}. Is it running (mocksmith start)?`
    );

    throw e;
  }

  return readApiResponse<T>(endpoint, res);
}

const patchSession = (patch: Record<string, unknown>) =>
  callApi('patchSession', { id: sessionId, patch });

const getSession = () => callApi<ApiData>('getSession', { id: sessionId });

/**
 * Parses a CLI value: tries JSON, falls back to the raw string.
 * */
function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Builds a nested object from a dot path: ('a.b.c', 1) -> { a: { b: { c: 1 } } }
 * */
function buildNested(path: string, value: unknown): Record<string, unknown> {
  const keys = path.split('.');
  const root: Record<string, unknown> = {};

  let cursor = root;

  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      cursor[key] = value;
    } else {
      cursor[key] = {};
      cursor = cursor[key] as Record<string, unknown>;
    }
  });

  return root;
}

/**
 * Reads a value from an object by a dot path.
 * */
function getByPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (acc, key) => (acc == null ? acc : (acc as Record<string, unknown>)[key]),
      obj
    );
}

const program = new Command();

program
  .name('mocksmith')
  .description('Start and control a mocksmith mock server at runtime')
  .option('-c, --config <path>', 'path to the config file')
  .option('--url <url>', 'URL of a running mock server')
  .option('--app-url <url>', 'app URL for the reload command')
  .option('--session <id>', 'session id')
  .option('--ssl', 'use HTTPS (certificates are taken from the config)')
  .showHelpAfterError();

program
  .command('start')
  .description('Start the mock server from a config file')
  .option(
    '--allow-unauthorized',
    'skip token/session-key checks and route connections into the default session'
  )
  .option('--host <host>', 'override host')
  .option('--port <port>', 'override port')
  .option('--raw-sockets', 'start raw TCP/TLS listeners from the config')
  .action(
    async (options: {
      allowUnauthorized?: boolean;
      host?: string;
      port?: string;
      rawSockets?: boolean;
    }) => {
      if (!resolvedConfig) {
        throw new Error('The start command requires --config <path> or MOCKSMITH_CONFIG');
      }

      const port = options.port ? Number(options.port) : undefined;

      if (port !== undefined && (!Number.isInteger(port) || port <= 0 || port > 65_535)) {
        throw new Error('--port must be an integer between 1 and 65535');
      }

      await startMockerFromConfig(resolvedConfig, {
        allowUnauthorized: options.allowUnauthorized,
        host: options.host,
        port,
        rawSockets: options.rawSockets,
        ssl: sslEnabled,
      });
    }
  );

const configCommand = program.command('config').description('Config inspection');

configCommand
  .command('print')
  .description('Print the loaded config and the base URL')
  .action(() => {
    if (!resolvedConfig) {
      throw new Error('The config print command requires --config <path> or MOCKSMITH_CONFIG');
    }

    log.info(JSON.stringify(resolvedConfig, null, 2));
  });

const showSession = async (path?: string) => {
  const data = await getSession();
  const value = path ? getByPath(data, path) : data;

  log.info(JSON.stringify(value, null, 2));
};

const setSessionValue = async (path: string, value: string) => {
  await patchSession(buildNested(path, parseValue(value)));
  log.info(`✅ set ${path} = ${value} (reload the page)`);
};

const setSessionDate = async (value: string) => {
  const date = value === 'clear' ? null : value;

  await patchSession({ date });
  log.info(`✅ date = ${date} (reload the page)`);
};

const patchSessionFromJson = async (json: string) => {
  await patchSession(JSON.parse(json));
  log.info(`✅ patch applied (reload the page)`);
};

const resetSession = async () => {
  await callApi('resetSession', { id: sessionId });
  log.info(`✅ session reset (reload the page or run mocksmith reload)`);
};

const sessionCommand = program.command('session').description('Session management');

sessionCommand
  .command('get [path]')
  .description('Print the session apiData, whole or a subtree by dot path')
  .action(showSession);

sessionCommand
  .command('set <path> <value>')
  .description('Set an arbitrary field by dot path (value is parsed as JSON)')
  .action(setSessionValue);

sessionCommand
  .command('date <iso|clear>')
  .description('Set the mocked date/time (ISO) or reset it (clear)')
  .action(setSessionDate);

sessionCommand
  .command('patch <json>')
  .description('Raw deep-merge of JSON into apiData (escape hatch)')
  .action(patchSessionFromJson);

sessionCommand
  .command('reset')
  .description('Reset the session to its initial data')
  .action(resetSession);

// Hidden short forms kept for backwards compatibility.
program.command('get [path]', { hidden: true }).action(showSession);
program.command('set <path> <value>', { hidden: true }).action(setSessionValue);
program.command('date <iso|clear>', { hidden: true }).action(setSessionDate);
program.command('patch <json>', { hidden: true }).action(patchSessionFromJson);
program.command('reset', { hidden: true }).action(resetSession);

const collectHeader = (kv: string, acc: Record<string, string>) => {
  const idx = kv.indexOf(':');

  if (idx === -1) {
    throw new Error(`--header must have the "Key: Value" form, got: ${kv}`);
  }

  acc[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();

  return acc;
};

type EndpointOptions = {
  status?: string;
  body?: string;
  header: Record<string, string>;
  delay?: string;
  abort?: boolean;
};

const setEndpoint = async (path: string, opts: EndpointOptions) => {
  const entry: Record<string, unknown> = {};

  if (opts.status) {
    entry.status = endpointOptionParsers.httpStatus(opts.status);
  }

  if (opts.body !== undefined) {
    entry.body = parseValue(opts.body);
  }

  if (opts.delay) {
    entry.delay = endpointOptionParsers.delay(opts.delay);
  }

  if (opts.abort) {
    entry.abort = true;
  }

  if (Object.keys(opts.header).length) {
    entry.headers = opts.header;
  }

  if (Object.keys(entry).length === 0) {
    throw new Error('Provide at least one of: --status, --body, --delay, --abort');
  }

  await callApi('setOverride', { id: sessionId, path, ...entry });
  log.info(`✅ override ${path}: ${JSON.stringify(entry)} (reload the page)`);
};

const clearEndpoint = async (path: string | undefined, opts: { all?: boolean }) => {
  if (!opts.all && !path) {
    throw new Error('Provide a path or --all');
  }

  await callApi('clearOverride', { id: sessionId, path, all: opts.all });
  log.info(`✅ override cleared: ${opts.all ? 'all' : path}`);
};

const listEndpoints = async () => {
  const list = await callApi('getOverrides', { id: sessionId });

  log.info(JSON.stringify(list, null, 2));
};

const addEndpointOptions = (command: Command) => {
  return command
    .option('--status <n>', 'HTTP response status')
    .option('--body <json>', 'response body (JSON or a string)')
    .option('--header <k:v>', 'response header (repeatable)', collectHeader, {})
    .option('--delay <ms>', 'response delay in ms')
    .option('--abort', 'drop the connection (network error)');
};

const endpointCommand = program
  .command('endpoint')
  .description('Endpoint override management');

addEndpointOptions(endpointCommand.command('set <path>'))
  .description('Override an endpoint response (status/body/headers/delay/abort)')
  .action(setEndpoint);

endpointCommand
  .command('clear [path]')
  .description('Clear an endpoint override (or --all for all of them)')
  .option('--all', 'clear all overrides')
  .action(clearEndpoint);

endpointCommand
  .command('list')
  .description('List active endpoint overrides')
  .action(listEndpoints);

addEndpointOptions(program.command('endpoint-set <path>', { hidden: true })).action(setEndpoint);
program.command('endpoint-clear [path]', { hidden: true }).option('--all').action(clearEndpoint);
program.command('endpoints', { hidden: true }).action(listEndpoints);

async function reloadApp() {
  if (!appUrl) {
    throw new Error('The reload command requires client.appUrl, --app-url or MOCKSMITH_APP_URI');
  }

  try {
    await fetch(`${appUrl}/__mock_reload`, { method: 'POST' });
  } catch (e) {
    log.error(`Could not reach the app at ${appUrl}. Is the dev server running?`);

    throw e;
  }
}

program
  .command('reload')
  .description('Reload the open browser (via the vite HMR full-reload plugin)')
  .action(async () => {
    await reloadApp();
    log.info('✅ browser reload requested');
  });

// --- Scenarios (*.scenario.ts) ----------------------------------------------

const applyScenario = async (file: string, opts: { reload?: boolean }) => {
  const scenario = await loadScenario(file);

  const summary = await applyScenarioViaApi(scenario, callApi, {
    sessionId,
    clearExisting: true,
  });

  log.info(
    `✅ scenario "${scenario.name ?? file}" applied: ${summary.paths} endpoint(s), ${
      summary.rules
    } rule(s)`
  );

  if (summary.reloadRequested && opts.reload !== false) {
    await reloadApp();
    log.info('✅ browser reload requested');
  } else {
    log.info('reload the page so the app re-reads the data');
  }
};

const clearScenario = async () => {
  await callApi('clearOverride', { id: sessionId, all: true });
  log.info('✅ scenario overrides cleared (for a full rollback run mocksmith session reset)');
};

const scenarioCommand = program.command('scenario').description('Mock scenario management');

scenarioCommand
  .command('apply <file>')
  .description('Apply a *.scenario.ts file: mock state + endpoint overrides')
  .option('--no-reload', 'do not reload the browser after applying')
  .action(applyScenario);

scenarioCommand.command('clear').description('Clear all scenario overrides').action(clearScenario);

program
  .command('scenario-apply <file>', { hidden: true })
  .option('--no-reload')
  .action(applyScenario);
program.command('scenario-clear', { hidden: true }).action(clearScenario);

program.parseAsync(process.argv).catch((e) => {
  log.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
