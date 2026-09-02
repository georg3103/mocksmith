import { defineScenario } from '@mocksmith/scenarios';

/**
 * "Somebody else is in the room."
 *
 * No endpoint is overridden here at all: the scenario only says the room is
 * busy, and the `chatter` plugin — which watches `chatter.on` — is what pushes
 * a line into the session and its sockets every couple of seconds. A scenario
 * describes the world; a plugin is where behaviour over time belongs.
 *
 * Because this is a session patch rather than an override, "Clear overrides"
 * does not undo it. Turn it off with the switch in the page,
 * `mocksmith session set chatter.on false`, or `mocksmith session reset`.
 * */
export default defineScenario({
  name: 'Busy room',
  feature: 'Live traffic',
  order: 1,
  description: 'The others keep talking: a new message arrives every few seconds.',
  session: {
    patch: { chatter: { on: true, everyMs: 2500 } },
  },
});
