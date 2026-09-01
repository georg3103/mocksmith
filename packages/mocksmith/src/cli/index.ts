import log from 'loglevel';

import { loadMockerConfig } from '../config/loadMockerConfig';
import { getMockEnv } from '../env';
import { createCliContext } from './context';
import { createProgram } from './createProgram';
import { cliEnvironment } from './env';
import { normalizeLegacySubcommand } from './normalizeLegacySubcommand';
import { addScenarioCommands } from './scenarioCommands';

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

addScenarioCommands(program, context);

// Legacy shorthands (`mocksmith endpoint /path --status 500`) are expanded right
// before parsing, so commands registered above — including plugin ones — are known.
normalizeLegacySubcommand(process.argv, 'endpoint', ['clear', 'help', 'list', 'set'], 'set');
normalizeLegacySubcommand(process.argv, 'scenario', ['apply', 'clear', 'help'], 'apply');

program.parseAsync(process.argv).catch((e) => {
  log.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
