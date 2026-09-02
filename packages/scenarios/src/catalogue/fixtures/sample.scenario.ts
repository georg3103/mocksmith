import { defineScenario } from '../../scenario/defineScenario';

export default defineScenario({
  name: 'Sample',
  session: { patch: { user: { plan: 'free' } } },
  endpoints: [{ path: '/api/items', status: 503 }],
});
