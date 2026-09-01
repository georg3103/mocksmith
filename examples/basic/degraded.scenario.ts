import { defineScenario } from 'mocksmith/scenario';

/**
 * "The shop is having a bad day": the profile downgrades to the free plan,
 * the item list is slow on the first call and fails on every call after it.
 * */
export default defineScenario({
  name: 'Degraded shop',
  feature: 'Reliability',
  description: 'Items time out once, then keep failing. The profile drops to the free plan.',
  session: {
    patch: { user: { plan: 'free' } },
    flags: { NEW_CHECKOUT: true },
  },
  endpoints: [
    {
      path: '/api/items',
      responses: [
        { status: 200, delay: 300, body: { items: [] } },
        { status: 503, body: { error: 'items unavailable' } },
      ],
    },
  ],
});
