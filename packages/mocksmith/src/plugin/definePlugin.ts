import { PLUGIN_API_VERSION, type MocksmithPlugin } from './types';

/**
 * Identity helper that types a plugin and fails early on the one mistake that
 * would otherwise surface much later: a missing name.
 * */
export const definePlugin = (plugin: MocksmithPlugin): MocksmithPlugin => {
  if (!plugin.name?.trim()) {
    throw new Error('plugin: "name" is required');
  }

  const version = plugin.apiVersion ?? PLUGIN_API_VERSION;

  if (version !== PLUGIN_API_VERSION) {
    throw new Error(
      `plugin "${plugin.name}" targets plugin API v${version}, this mocksmith supports v${PLUGIN_API_VERSION}`
    );
  }

  return plugin;
};
