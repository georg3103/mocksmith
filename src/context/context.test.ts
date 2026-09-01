import { EventEmitter } from 'events';
import { vi } from 'vitest';
import WebSocket from 'ws';

import { MockContext } from './context';

class FakeWebSocket extends EventEmitter {
  public readyState: WebSocket['readyState'] = WebSocket.OPEN;

  public close = vi.fn((code?: number, reason?: string) => {
    this.readyState = WebSocket.CLOSED;
    this.emit('close', code ?? 1000, Buffer.from(reason ?? ''));
  });
}

describe('MockContext websocket diagnostics', () => {
  it('registers connections and updates diagnostics after close', () => {
    const context = new MockContext({});
    const firstSocket = new FakeWebSocket();
    const secondSocket = new FakeWebSocket();

    context.registerWebsocket('/core/mockfe3/', firstSocket as unknown as WebSocket);
    context.registerWebsocket('/core/mockfe3/', secondSocket as unknown as WebSocket);

    expect(context.getWebsocketDiagnostics('/core/mockfe3/')).toEqual({
      paths: {
        '/core/mockfe3/': {
          active: 2,
          closed: 0,
          lastConnectionId: 2,
          total: 2,
        },
      },
      connections: [
        expect.objectContaining({
          active: true,
          id: 1,
          path: '/core/mockfe3/',
        }),
        expect.objectContaining({
          active: true,
          id: 2,
          path: '/core/mockfe3/',
        }),
      ],
      messages: [],
    });

    firstSocket.close(1001, 'test close');

    expect(context.getWebsocketDiagnostics('/core/mockfe3/')).toEqual({
      paths: {
        '/core/mockfe3/': {
          active: 1,
          closed: 1,
          lastConnectionId: 2,
          total: 2,
        },
      },
      connections: [
        expect.objectContaining({
          active: false,
          closeCode: 1001,
          closeReason: 'test close',
          id: 1,
          path: '/core/mockfe3/',
        }),
        expect.objectContaining({
          active: true,
          id: 2,
          path: '/core/mockfe3/',
        }),
      ],
      messages: [],
    });
  });

  it('closes only the active connections of the selected path', () => {
    const context = new MockContext({});
    const firstSocket = new FakeWebSocket();
    const secondSocket = new FakeWebSocket();

    context.registerWebsocket('/core/mockfe3/', firstSocket as unknown as WebSocket);
    context.registerWebsocket('/core/mockfe4/', secondSocket as unknown as WebSocket);

    expect(context.closeWebsockets('/core/mockfe3/', 4001, 'forced close')).toBe(1);

    expect(firstSocket.close).toHaveBeenCalledWith(4001, 'forced close');
    expect(secondSocket.close).not.toHaveBeenCalled();
    expect(context.getWebsocketDiagnostics()).toEqual({
      paths: {
        '/core/mockfe3/': {
          active: 0,
          closed: 1,
          lastConnectionId: 1,
          total: 1,
        },
        '/core/mockfe4/': {
          active: 1,
          closed: 0,
          lastConnectionId: 2,
          total: 1,
        },
      },
      connections: [
        expect.objectContaining({
          active: false,
          closeCode: 4001,
          closeReason: 'forced close',
          id: 1,
          path: '/core/mockfe3/',
        }),
        expect.objectContaining({
          active: true,
          id: 2,
          path: '/core/mockfe4/',
        }),
      ],
      messages: [],
    });
  });

  it('records incoming websocket messages so subscriptions can be asserted', () => {
    const context = new MockContext({});
    const socket = new FakeWebSocket();

    context.registerWebsocket('/core/mockfe3/', socket as unknown as WebSocket);
    context.recordWebsocketMessages('/core/mockfe3/', socket as unknown as WebSocket, [
      {
        data: {
          DataFlowType: 7,
          FlowKeys: [100, 200],
          SubscribeType: 1,
        },
        type: 'DataFlowSubscribeEntity',
      },
    ]);

    expect(context.getWebsocketDiagnostics('/core/mockfe3/').messages).toEqual([
      expect.objectContaining({
        connectionId: 1,
        dataFlowType: 7,
        flowKeys: [100, 200],
        path: '/core/mockfe3/',
        subscribeType: 1,
        type: 'DataFlowSubscribeEntity',
      }),
    ]);
  });
});

describe('MockContext apiData runtime control', () => {
  const makeApiData = () => ({
    user: { name: 'Ada', accounts: [{ id: 1 }, { id: 2 }] },
    remoteConfigFlags: { FLAG_A: true } as Record<string, unknown>,
    instruments: [
      { assetId: 'SBER', limitsData: { FreeMoney: 13000, Quantity: 1000 } },
      { assetId: 'VTBR', limitsData: { FreeMoney: 13000, Quantity: 2000 } },
    ],
    date: undefined as string | undefined,
  });

  test('getApiData returns the provided apiData', () => {
    const data = makeApiData();
    const ctx = new MockContext(data, 'test');

    expect(ctx.getApiData()).toEqual(data);
  });

  test('patchApiData deep-merges and keeps sibling fields', () => {
    const ctx = new MockContext(makeApiData(), 'test');

    ctx.patchApiData({ user: { name: 'Grace' } });

    const result = ctx.getApiData() as ReturnType<typeof makeApiData>;

    expect(result.user.name).toBe('Grace');
    // the sibling field inside user survived
    expect(result.user.accounts).toEqual([{ id: 1 }, { id: 2 }]);
    // other branches are untouched
    expect(result.remoteConfigFlags.FLAG_A).toBe(true);
  });

  test('patchApiData adds a new flag without touching the existing ones', () => {
    const ctx = new MockContext(makeApiData(), 'test');

    ctx.patchApiData({ remoteConfigFlags: { FLAG_B: false } });

    const flags = (ctx.getApiData() as ReturnType<typeof makeApiData>).remoteConfigFlags;

    expect(flags).toEqual({ FLAG_A: true, FLAG_B: false });
  });

  test('patchApiData merges arrays by index', () => {
    const ctx = new MockContext(makeApiData(), 'test');

    ctx.patchApiData({
      instruments: [{ limitsData: { FreeMoney: 9999 } }, { limitsData: { FreeMoney: 9999 } }],
    });

    const instruments = (ctx.getApiData() as ReturnType<typeof makeApiData>).instruments;

    // the patched field is updated, the rest of the item survives
    expect(instruments[0]).toEqual({
      assetId: 'SBER',
      limitsData: { FreeMoney: 9999, Quantity: 1000 },
    });
    expect(instruments[1].limitsData.FreeMoney).toBe(9999);
  });

  test('patchApiData sets a scalar field (date)', () => {
    const ctx = new MockContext(makeApiData(), 'test');

    ctx.patchApiData({ date: '2026-01-01T10:00:00Z' });

    expect((ctx.getApiData() as ReturnType<typeof makeApiData>).date).toBe('2026-01-01T10:00:00Z');
  });

  test('resetApiData restores the initial state after patches', () => {
    // Snapshot taken before mutations: ctx holds apiData by reference, so
    // makeApiData() itself would be mutated by patches — compare with a clone.
    const expected = makeApiData();
    const ctx = new MockContext(makeApiData(), 'test');

    ctx.patchApiData({ user: { name: 'Grace' } });
    ctx.patchApiData({ remoteConfigFlags: { FLAG_B: true } });
    ctx.patchApiData({ date: '2026-01-01T10:00:00Z' });

    ctx.resetApiData();

    expect(ctx.getApiData()).toEqual(expected);
  });

  test('the reset snapshot is independent of later apiData mutations', () => {
    const ctx = new MockContext(makeApiData(), 'test');
    const snapshotBefore = structuredClone(ctx.getApiData());

    ctx.patchApiData({ user: { name: 'Grace' } });
    ctx.resetApiData();

    expect(ctx.getApiData()).toEqual(snapshotBefore);
    // reset returns a new object, not a reference to the internal snapshot
    expect(ctx.getApiData()).not.toBe(snapshotBefore);
  });
});

describe('MockContext endpoint overrides', () => {
  test('getOverride finds an override by exact path', () => {
    const ctx = new MockContext({}, 'test');

    ctx.setOverride('/api/x', { status: 500, body: { err: 'boom' } });

    expect(ctx.getOverride('/api/x')).toEqual({ status: 500, body: { err: 'boom' } });
    expect(ctx.getOverride('/api/y')).toBeUndefined();
  });

  test('getOverride matches a path-to-regexp pattern', () => {
    const ctx = new MockContext({}, 'test');

    ctx.setOverride('/api/items/:id', { status: 404 });

    expect(ctx.getOverride('/api/items/42')).toEqual({ status: 404 });
    expect(ctx.getOverride('/api/items')).toBeUndefined();
  });

  test('an exact match wins over a pattern', () => {
    const ctx = new MockContext({}, 'test');

    ctx.setOverride('/api/items/:id', { status: 404 });
    ctx.setOverride('/api/items/42', { status: 200 });

    expect(ctx.getOverride('/api/items/42')).toEqual({ status: 200 });
  });

  test('clearOverride removes one, clearOverrides removes all', () => {
    const ctx = new MockContext({}, 'test');

    ctx.setOverride('/api/a', { status: 500 });
    ctx.setOverride('/api/b', { status: 503 });

    ctx.clearOverride('/api/a');
    expect(ctx.getOverride('/api/a')).toBeUndefined();
    expect(ctx.getOverride('/api/b')).toEqual({ status: 503 });

    ctx.clearOverrides();
    expect(ctx.listOverrides()).toEqual([]);
  });

  test('listOverrides returns the path plus its rules', () => {
    const ctx = new MockContext({}, 'test');

    ctx.setOverride('/api/a', { status: 500, delay: 1000 });

    expect(ctx.listOverrides()).toEqual([
      { path: '/api/a', rules: [{ status: 500, delay: 1000 }] },
    ]);
  });

  test('resetApiData clears overrides', () => {
    const ctx = new MockContext({}, 'test');

    ctx.setOverride('/api/a', { status: 500 });
    ctx.resetApiData();

    expect(ctx.getOverride('/api/a')).toBeUndefined();
  });

  test('responses answers by call number, the last one repeating', () => {
    const ctx = new MockContext({}, 'test');

    ctx.setOverride('/api/feed', {
      responses: [
        { status: 200, body: { page: 1 } },
        { status: 200, body: { page: 2 } },
        { status: 500 },
      ],
    });

    expect(ctx.getOverride('/api/feed')).toEqual({ status: 200, body: { page: 1 } });
    expect(ctx.getOverride('/api/feed')).toEqual({ status: 200, body: { page: 2 } });
    expect(ctx.getOverride('/api/feed')).toEqual({ status: 500 });
    // the last one repeats
    expect(ctx.getOverride('/api/feed')).toEqual({ status: 500 });
  });

  test('setting an override again resets the responses counter', () => {
    const ctx = new MockContext({}, 'test');

    ctx.setOverride('/api/feed', { responses: [{ status: 200 }, { status: 500 }] });
    ctx.getOverride('/api/feed'); // → 200

    ctx.setOverride('/api/feed', { responses: [{ status: 200 }, { status: 500 }] });

    expect(ctx.getOverride('/api/feed')).toEqual({ status: 200 });
  });

  test('when.query selects a rule by query (operator and exact match)', () => {
    const ctx = new MockContext({}, 'test');

    ctx.setOverride('/api/feed', [
      { when: { query: { offset: '>=40' } }, status: 500 },
      { status: 200, body: { ok: true } }, // fallback without a condition
    ]);

    expect(ctx.getOverride('/api/feed', { offset: '40' })).toEqual({ status: 500 });
    expect(ctx.getOverride('/api/feed', { offset: '60' })).toEqual({ status: 500 });
    expect(ctx.getOverride('/api/feed', { offset: '20' })).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(ctx.getOverride('/api/feed', {})).toEqual({ status: 200, body: { ok: true } });
  });

  test('getOverride takes the query into account on an exact string match', () => {
    const ctx = new MockContext({}, 'test');

    ctx.setOverride('/api/feed', [
      { when: { query: { tab: 'news' } }, status: 418 },
      { status: 200 },
    ]);

    expect(ctx.getOverride('/api/feed', { tab: 'news' })).toEqual({ status: 418 });
    expect(ctx.getOverride('/api/feed', { tab: 'ideas' })).toEqual({ status: 200 });
  });
});
