import { defineScenario } from '@mocksmith/scenarios';

/**
 * "The board is having a bad day": the plan drops to free, the first load is
 * slow and comes back empty, and every load after it fails. `responses` are
 * answered by call number and the last one repeats.
 * */
export default defineScenario({
  name: 'Flaky board',
  feature: 'Reliability',
  description: 'The board loads empty once, then keeps failing. The plan drops to free.',
  session: {
    patch: { user: { plan: 'free' } },
    flags: { NEW_CHECKOUT: true },
  },
  endpoints: [
    {
      path: '/api/board',
      responses: [
        { status: 200, delay: 300, body: { user: { name: 'Ada', plan: 'free' }, todos: [] } },
        { status: 503, body: { error: 'board unavailable' } },
      ],
    },
    { path: '/api/todos', status: 503, body: { error: 'board unavailable' } },
  ],
});
