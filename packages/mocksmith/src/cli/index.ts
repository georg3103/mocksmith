import log from 'loglevel';
import { pathToFileURL } from 'node:url';

import { loadMockerConfig } from '../config/loadMockerConfig';
import { getMockEnv } from '../env';
import { resolvePlugins } from '../plugin/resolvePlugins';
import { importModule } from '../utils/importModule';
import { createCliContext } from './context';
import { createProgram } from './createProgram';
import { cliEnvironment } from './env';
import { normalizeLegacySubcommand } from './normalizeLegacySubcommand';
import { registerPluginCommands } from './registerPluginCommands';

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

const context = createCliContext({ baseUrl, appUrl, sessionId, resolvedConfig, sslEnabled });
const program = createProgram(context);

// Plugins contribute commands here. Resolving them only imports modules and
// calls factories — no hook runs, so listing `--help` never starts a server.
const plugins = resolvedConfig ? await resolvePlugins(resolvedConfig) : [];
const pluginDefaults = registerPluginCommands(program, plugins, {
  callApi: context.callApi,
  sessionId: context.sessionId,
  getBaseUrl: context.getBaseUrl,
  appUrl: context.appUrl,
  reloadApp: context.reloadApp,
  resolvedConfig,
  configDirectory: resolvedConfig?.configDirectory,
  loadModule: <T,>(specifier: string) =>
    importModule(
      specifier,
      resolvedConfig ? pathToFileURL(resolvedConfig.configPath).href : undefined
    ) as Promise<T>,
  log,
});

// Legacy shorthands are expanded right before parsing, once every command —
// built-in and plugin-contributed — is known.
normalizeLegacySubcommand(process.argv, 'endpoint', ['clear', 'help', 'list', 'set'], 'set');

for (const { name, subcommand, known } of pluginDefaults) {
  normalizeLegacySubcommand(process.argv, name, known, subcommand);
}

program.parseAsync(process.argv).catch((e) => {
  log.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
