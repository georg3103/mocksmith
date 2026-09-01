import type { MockFunction, MockHandlers, MocksAPI } from 'mocksmith';

type ShopApi = MocksAPI & {
  user: { name: string; plan: 'free' | 'pro' };
  items: Array<{ id: number; title: string; price: number }>;
};

const getProfile: MockFunction<ShopApi> = (api) => ({
  response: {
    headers: { 'content-type': 'application/json' },
    body: { name: api.user.name, plan: api.user.plan },
  },
});

const getItems: MockFunction<ShopApi> = (api) => ({
  response: {
    headers: { 'content-type': 'application/json' },
    body: { items: api.items },
  },
});

/**
 * A handler may also push into the session's open websockets — the third
 * argument sends a message to every socket bound to this session.
 * */
const notify: MockFunction<ShopApi> = (api, _params, sendToWebSocket) => {
  sendToWebSocket({ type: 'notification', text: `Hello, ${api.user.name}!` });

  return {
    response: {
      headers: { 'content-type': 'application/json' },
      body: { sent: true },
    },
  };
};

export default {
  '/api/profile': getProfile,
  '/api/items': getItems,
  '/api/notify': notify,
} satisfies MockHandlers<ShopApi>;
