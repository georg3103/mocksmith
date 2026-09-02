import { defineScenario } from '@mocksmith/scenarios';

/**
 * "The archive is down, the room is fine."
 *
 * The rule matches on the query, so only the pages behind a cursor break:
 * `?before=<id>` is always a positive number, the first load carries no cursor
 * at all, and a request that matches no rule goes to the real handler. Opening
 * the room works; scrolling back does not.
 * */
export default defineScenario({
  name: 'History gap',
  feature: 'Reliability',
  order: 1,
  description: 'The room opens, but older pages fail to load.',
  endpoints: [
    {
      path: '/api/rooms/:id/messages',
      when: { query: { before: '>0' } },
      status: 503,
      delay: 200,
      body: { error: 'history is unavailable' },
    },
  ],
});
