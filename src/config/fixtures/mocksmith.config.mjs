export default {
  server: { port: 3102 },
  handlers: [
    {
      '/inline-js': {
        response: {
          body: { source: 'js' },
        },
      },
    },
  ],
  defaultSessionData: {
    remoteConfigFlags: {
      JS_CONFIG: true,
    },
  },
  client: { sessionId: 'js-session' },
};
