/**
 * The world every session starts from. `mocksmith session reset` restores
 * exactly this, and the Playwright fixture hands a copy of it to each test.
 * */
export default {
  user: { name: 'Ada', plan: 'pro' as 'free' | 'pro' },
  todos: [
    { id: 1, title: 'Heat the forge', done: true },
    { id: 2, title: 'Hammer the anvil flat', done: false },
    { id: 3, title: 'Quench and file', done: false },
  ],
  remoteConfigFlags: {
    NEW_CHECKOUT: false,
  },
};
