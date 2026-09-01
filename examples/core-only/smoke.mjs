/**
 * Proves the promise of the package split: with only `mocksmith` installed you
 * still get a working mock server — sessions, endpoint overrides, the runtime
 * API — and the companion packages are genuinely absent, not merely unused.
 * */
import assert from 'node:assert/strict';

import { loadMockerConfig, startMockerFromConfig } from 'mocksmith/config';

const BASE = 'http://127.0.0.1:3102';

const api = async (endpoint, body) => {
  const response = await fetch(`${BASE}/__mocks/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  assert.equal(response.ok, true, `${endpoint} responded with ${response.status}`);

  return response.json();
};

// 1. None of the optional packages resolve from here.
for (const name of ['@mocksmith/scenarios', '@mocksmith/playwright', '@mocksmith/vite']) {
  await assert.rejects(
    () => import(name),
    (error) => error.code === 'ERR_MODULE_NOT_FOUND',
    `${name} should not be installed in the core-only example`
  );
}

// 2. The scenario CLI command is absent too — it belongs to the plugin.
const resolved = await loadMockerConfig('./mocksmith.config.ts');

assert.equal(resolved.config.plugins, undefined);

const server = await startMockerFromConfig(resolved);

try {
  // 3. Handlers read the session data.
  assert.deepEqual(await (await fetch(`${BASE}/api/profile`)).json(), {
    name: 'Ada',
    plan: 'pro',
  });

  // 4. Session patching works without any plugin.
  await api('patchSession', { id: 'default', patch: { user: { plan: 'free' } } });
  assert.equal((await (await fetch(`${BASE}/api/profile`)).json()).plan, 'free');

  // 5. Endpoint overrides are core functionality, not a scenario feature.
  await api('setOverride', { id: 'default', path: '/api/profile', status: 503, body: { down: true } });

  const broken = await fetch(`${BASE}/api/profile`);

  assert.equal(broken.status, 503);

  await api('clearOverride', { id: 'default', all: true });
  assert.equal((await fetch(`${BASE}/api/profile`)).status, 200);

  // 6. Reset restores the initial session.
  await api('resetSession', { id: 'default' });
  assert.equal((await (await fetch(`${BASE}/api/profile`)).json()).plan, 'pro');

  console.log('✅ core-only smoke passed: server, sessions, overrides — no companion packages');
} finally {
  server.close();
}
