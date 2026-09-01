import { systemHandlers } from './systemHandlers';

/**
 * Guards the system API surface. These routes are the protocol every client
 * speaks — the CLI, the Playwright fixture and plugins alike — so a route
 * disappearing or being renamed is a breaking change that must be deliberate.
 * */
describe('system API contract', () => {
  test('exposes exactly the documented routes', () => {
    expect(Object.keys(systemHandlers).sort()).toEqual([
      '/__mocks/api/clearOverride',
      '/__mocks/api/clearSession',
      '/__mocks/api/createSession',
      '/__mocks/api/getOverrides',
      '/__mocks/api/getSession',
      '/__mocks/api/patchSession',
      '/__mocks/api/resetSession',
      '/__mocks/api/sendToWebsocket',
      '/__mocks/api/setOverride',
      '/__mocks/api/websockets/close',
      '/__mocks/api/websockets/state',
    ]);
  });

  test('every route is callable', () => {
    for (const [route, handler] of Object.entries(systemHandlers)) {
      expect(typeof handler, `${route} must be a function`).toBe('function');
    }
  });
});
