import type { LogLevelDesc } from 'loglevel';

const DEFAULT_MOCK_APP_URI = 'https://localhost:3000';
const DEFAULT_MOCK_BACKEND_PORT = 3001;
const DEFAULT_LOG_LEVEL: LogLevelDesc = 'info';

export const getMockEnv = () => ({
  appUri: process.env.MOCKSMITH_APP_URI || DEFAULT_MOCK_APP_URI,
  backendPort: Number(process.env.MOCKSMITH_PORT) || DEFAULT_MOCK_BACKEND_PORT,
  logLevel: (process.env.MOCKSMITH_LOG_LEVEL as LogLevelDesc | undefined) || DEFAULT_LOG_LEVEL,
});
