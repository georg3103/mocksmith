import type { MockFunction, MockHandlers, MocksAPI } from 'mocksmith';

type ShopApi = MocksAPI & {
  user: { name: string; plan: 'free' | 'pro' };
};

const getProfile: MockFunction<ShopApi> = (api) => ({
  response: {
    headers: { 'content-type': 'application/json' },
    body: api.user,
  },
});

export default { '/api/profile': getProfile } satisfies MockHandlers<ShopApi>;
