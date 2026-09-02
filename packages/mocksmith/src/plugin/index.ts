/**
 * `mocksmith/plugin` — everything a plugin author needs, and nothing else.
 *
 * The host that loads and drives plugins lives in `src/pluginHost` and is not
 * exported: it used to be re-exported from here, which made every internal of
 * the runtime part of the public surface even though its only callers import it
 * by path.
 * */
export { definePlugin } from './definePlugin';
export { SystemApiError } from './SystemApiError';

export {
  PLUGIN_API_VERSION,
  type MockerPluginDiscovery,
  type MockerPluginEntry,
  type MocksmithPlugin,
  type MocksmithPluginFactory,
  type PluginCliArg,
  type PluginCliCommand,
  type PluginCliContext,
  type PluginCliOption,
  type PluginConfigEnv,
  type PluginLogger,
  type PluginServerContext,
  type PluginSessionContext,
  type PluginSetupContext,
  type PluginSystemHandler,
  type SessionsFacade,
} from './types';
