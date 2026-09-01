export const cliEnvironment = {
  allowInsecureLocalTls: () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  },
  appUrl: process.env.MOCKSMITH_APP_URI,
  configPath: process.env.MOCKSMITH_CONFIG,
  serverUrl: process.env.MOCKSMITH_URI,
  sessionId: process.env.MOCKSMITH_SESSION_ID,
};
