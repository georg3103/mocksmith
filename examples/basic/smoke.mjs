/**
 * End-to-end smoke check of the published package: starts the mock server from
 * the config, then exercises HTTP mocks, the system API, scenarios, websockets
 * and SSE against it. Run with `npm run smoke` inside examples/basic.
 * */
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

import { loadMockerConfig, startMockerFromConfig } from 'mocksmith/config';
import { applyScenarioViaApi, loadScenario } from 'mocksmith/scenario';

const BASE = 'http://127.0.0.1:3101';

const api = async (endpoint, body) => {
  const response = await fetch(`${BASE}/__mocks/api/${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  assert.equal(response.ok, true, `${endpoint} responded with ${response.status}`);

  return response.json();
};

const resolved = await loadMockerConfig('./mocksmith.config.ts');
const server = await startMockerFromConfig(resolved);

try {
  // 1. HTTP mocks read from the session data
  const profile = await (await fetch(`${BASE}/api/profile`)).json();

  assert.deepEqual(profile, { name: 'Ada', plan: 'pro' });

  const { items } = await (await fetch(`${BASE}/api/items`)).json();

  assert.equal(items.length, 3);

  // 2. Runtime session patching through the system API
  await api('patchSession', { id: 'default', patch: { user: { name: 'Grace' } } });
  assert.equal((await (await fetch(`${BASE}/api/profile`)).json()).name, 'Grace');

  // 3. Websockets: echo plus a push from an HTTP handler
  const socket = new WebSocket(`ws://127.0.0.1:3101/ws`);
  const messages = [];

  socket.on('message', (data) => messages.push(JSON.parse(String(data))));
  await new Promise((resolve) => socket.once('open', resolve));

  socket.send('ping');
  await fetch(`${BASE}/api/notify`);
  await delay(200);

  assert.deepEqual(messages[0], { type: 'echo', payload: 'ping' });
  assert.equal(messages[1].type, 'notification');

  const diagnostics = await api('websockets/state', { id: 'default' });

  assert.equal(diagnostics.connections.length, 1);
  socket.close();

  // 4. SSE stream
  const stream = await fetch(`${BASE}/sse/ticks`);
  const reader = stream.body.getReader();
  const chunk = new TextDecoder().decode((await reader.read()).value);

  assert.match(chunk, /"tick":1/);
  await reader.cancel();

  // 5. Scenario: a session patch plus responses by call number
  const scenario = await loadScenario('./degraded.scenario.ts');

  await applyScenarioViaApi(scenario, api, { sessionId: 'default', clearExisting: true });

  assert.equal((await (await fetch(`${BASE}/api/profile`)).json()).plan, 'free');

  const first = await fetch(`${BASE}/api/items`);
  const second = await fetch(`${BASE}/api/items`);
  const third = await fetch(`${BASE}/api/items`);

  assert.equal(first.status, 200);
  assert.equal(second.status, 503);
  assert.equal(third.status, 503, 'the last response repeats');

  // 6. Session reset drops the scenario patch
  await api('clearOverride', { id: 'default', all: true });
  await api('resetSession', { id: 'default' });
  assert.deepEqual(await (await fetch(`${BASE}/api/profile`)).json(), { name: 'Ada', plan: 'pro' });

  console.log('✅ smoke passed: HTTP, system API, websockets, SSE, scenarios, reset');
} finally {
  server.close();
}
