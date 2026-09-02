import * as pluginEntry from './index';

/**
 * `mocksmith/plugin` is the contract plugin authors compile against, so its
 * shape is pinned the way the system routes are.
 *
 * The list once quietly grew to include the runtime — createPluginHost,
 * resolvePlugins, the system-route mergers — which nobody outside the package
 * imports and which could then not be reshaped without a breaking change.
 * */
describe('the mocksmith/plugin entry', () => {
  test('exports the author API and nothing else', () => {
    expect(Object.keys(pluginEntry).sort()).toEqual([
      'PLUGIN_API_VERSION',
      'SystemApiError',
      'definePlugin',
    ]);
  });

  test('SystemApiError carries the status and the body', () => {
    const error = new pluginEntry.SystemApiError('/__mocks/api/applyScenario', 404, {
      result: 'not-found',
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SystemApiError');
    expect(error.status).toBe(404);
    expect(error.body).toEqual({ result: 'not-found' });
    expect(error.message).toContain('applyScenario');
  });
});
