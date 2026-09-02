/**
 * The plugin runtime: loading plugins, driving their hooks, and merging what
 * they contribute into the server.
 *
 * Internal on purpose — nothing here is exported from the package. A plugin
 * author needs `mocksmith/plugin`; this is the side that calls them.
 * */
export { createPluginHost, type PluginHost, type PluginRegistries } from './createPluginHost';
export { discoverPlugins, DEFAULT_DISCOVERY_PATTERNS } from './discoverPlugins';
export { instantiatePlugin, isPluginObject, isRecord } from './normalizePlugin';
export { resolvePlugins } from './resolvePlugins';
export { createSystemApiCaller, type SystemApiCaller } from './systemApi';
export { addPluginSystemHandlers, mergeSystemHandlers } from './systemRoutes';
