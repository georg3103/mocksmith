import { defineScenario } from '@mocksmith/scenarios';

/**
 * "You can read the room, you just cannot answer it."
 *
 * The two answers are different failures on purpose. `abort` destroys the
 * connection: reaching the mock server directly, that is a transport error
 * (`TypeError: Failed to fetch`) with no status at all; behind a dev-server
 * proxy — which is how this demo talks to it — the proxy answers the hung-up
 * upstream with a 500 of its own. Either way it exercises a different branch
 * from the 503 that follows, because the last response in the list repeats.
 * */
export default defineScenario({
  name: 'Broken send',
  feature: 'Reliability',
  order: 2,
  description: 'The first send drops the connection, every one after it fails with 503.',
  endpoints: [
    {
      path: '/api/rooms/:id/outbox',
      responses: [
        { delay: 300, abort: true },
        { status: 503, body: { error: 'the outbox is unavailable' } },
      ],
    },
  ],
});
