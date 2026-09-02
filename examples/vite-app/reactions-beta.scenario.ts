import { defineScenario } from '@mocksmith/scenarios';

/**
 * A scenario that changes no endpoint at all: it flips a remote-config flag and
 * upgrades the plan. The reactions endpoint refuses while the flag is off, so
 * the flag is the whole feature — server and UI alike — rather than a switch
 * the page decides to honour.
 * */
export default defineScenario({
  name: 'Reactions beta',
  feature: 'Feature flags',
  order: 1,
  description: 'Turns reactions on for this session: hover a message to react.',
  session: {
    patch: { me: { plan: 'pro' } },
    flags: { REACTIONS: true },
  },
});
