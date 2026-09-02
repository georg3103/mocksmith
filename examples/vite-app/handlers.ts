import type { MockData, MockFunction, MockHandlers } from 'mocksmith';

import { postMessage } from './messages';
import type { ChatApi } from './types';

/** How many messages one page of history holds. */
export const PAGE_SIZE = 10;

const json = (body: unknown, status = 200): MockData => ({
  response: {
    status,
    headers: { 'content-type': 'application/json' },
    body: body as MockData['response']['body'],
  },
});

/**
 * Handlers are keyed by path, not by method — the method is read from the
 * request itself. `request` is absent only when a plugin calls a handler
 * in-process, which never happens here.
 * */
const methodOf = (request?: { method?: string }) => request?.method?.toUpperCase() ?? 'GET';

/**
 * `api` is a shallow copy made per request, so writes go through the session
 * itself: `context.getApiData()` is the live object the whole session reads.
 * */
const stateOf = (context: { getApiData: () => unknown }) => context.getApiData() as ChatApi;

const queryOf = (query: unknown) => (query ?? {}) as Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

const findMessage = (state: ChatApi, id: number) =>
  Object.values(state.messages)
    .flat()
    .find((message) => message.id === id);

/**
 * GET /api/me — identity plus the feature flags, so a flag flip is visible on
 * screen. `sessionId` goes out too: the page drives the system API (the
 * scenario menu) and has to name its own session rather than the default one.
 * */
const me: MockFunction<ChatApi> = (api, { context }) =>
  json({ me: api.me, flags: api.remoteConfigFlags, chatter: api.chatter, sessionId: context.id });

/** GET /api/rooms — the sidebar: unread counts and a preview of the last line. */
const rooms: MockFunction<ChatApi> = (api) =>
  json({
    rooms: api.rooms.map((room) => {
      const messages = api.messages[room.id] ?? [];
      const last = messages[messages.length - 1];

      return { ...room, preview: last?.text ?? '', lastAt: last?.at };
    }),
  });

const roomOf = (state: ChatApi, requestData: { urlParams?: unknown }) => {
  const id = String((requestData.urlParams as { id?: string })?.id ?? '');

  return { id, room: state.rooms.find((item) => item.id === id) };
};

/**
 * GET /api/rooms/:id/messages — one page of history, newest last.
 *
 * `?before=<id>` walks backwards; the absence of the parameter is what an
 * override rule keys on to break only the older pages (see History gap).
 * */
const messages: MockFunction<ChatApi> = (_api, { context, request, requestData }) => {
  const state = stateOf(context);
  const { id: roomId, room } = roomOf(state, requestData);

  if (methodOf(request) !== 'GET') {
    return json({ error: 'sending goes to /api/rooms/:id/outbox' }, 405);
  }

  if (!room) {
    return json({ error: `no room called ${roomId}` }, 404);
  }

  const all = state.messages[roomId] ?? [];
  const query = queryOf(requestData.query);
  const before = Number(first(query.before));
  const older = Number.isFinite(before) && before > 0 ? all.filter((item) => item.id < before) : all;
  const page = older.slice(-PAGE_SIZE);

  return json({ messages: page, hasMore: older.length > page.length, room });
};

/**
 * POST /api/rooms/:id/outbox — sends a message, then pushes it into this
 * session's websockets so any other open tab shows it without asking.
 *
 * Sending has a path of its own, and that is deliberate: **overrides are keyed
 * by path, not by method**. Were the composer posting to
 * `/api/rooms/:id/messages`, a scenario breaking sending would break reading
 * the room as well, and "the message will not go, but the room is fine" —
 * exactly the state worth testing — could not be expressed.
 * */
const outbox: MockFunction<ChatApi> = (_api, { context, requestData }, sendToWebSocket) => {
  const state = stateOf(context);
  const { id: roomId, room } = roomOf(state, requestData);

  if (!room) {
    return json({ error: `no room called ${roomId}` }, 404);
  }

  const text = String((requestData.body as { text?: unknown })?.text ?? '').trim();

  if (!text) {
    return json({ error: 'text is required' }, 422);
  }

  const message = postMessage(state, { authorId: state.me.id, roomId, text });

  state.typing = state.typing.filter((name) => name !== state.me.name);
  sendToWebSocket({ type: 'message', message });

  return json({ message }, 201);
};

/** POST /api/rooms/:id/read — clears the unread badge. */
const read: MockFunction<ChatApi> = (_api, { context, requestData }, sendToWebSocket) => {
  const state = stateOf(context);
  const { id: roomId, room } = roomOf(state, requestData);

  if (!room) {
    return json({ error: `no room called ${roomId}` }, 404);
  }

  room.unread = 0;
  sendToWebSocket({ type: 'rooms', rooms: state.rooms });

  return json({ room });
};

/**
 * POST /api/messages/:id/reactions — toggles one emoji.
 *
 * Gated by the REACTIONS flag: the endpoint refuses when the flag is off, the
 * same way a real backend would, instead of leaving the flag as UI-only sugar.
 * */
const reactions: MockFunction<ChatApi> = (_api, { context, requestData }, sendToWebSocket) => {
  const state = stateOf(context);

  if (!state.remoteConfigFlags.REACTIONS) {
    return json({ error: 'reactions are off for this account' }, 403);
  }

  const message = findMessage(state, Number((requestData.urlParams as { id?: string })?.id));

  if (!message) {
    return json({ error: 'no such message' }, 404);
  }

  const emoji = String((requestData.body as { emoji?: unknown })?.emoji ?? '').trim();

  if (!emoji) {
    return json({ error: 'emoji is required' }, 422);
  }

  const current = message.reactions?.[emoji] ?? [];
  const next = current.includes(state.me.id)
    ? current.filter((id) => id !== state.me.id)
    : [...current, state.me.id];

  message.reactions = { ...message.reactions, [emoji]: next };

  if (!next.length) {
    delete message.reactions[emoji];
  }

  sendToWebSocket({ type: 'message-updated', message });

  return json({ message });
};

export default {
  '/api/me': me,
  '/api/rooms': rooms,
  '/api/rooms/:id/messages': messages,
  '/api/rooms/:id/outbox': outbox,
  '/api/rooms/:id/read': read,
  '/api/messages/:id/reactions': reactions,
} satisfies MockHandlers<ChatApi>;
