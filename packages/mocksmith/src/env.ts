import type { LogLevelDesc } from 'loglevel';

const DEFAULT_MOCK_APP_URI = 'http://localhost:3000';
const DEFAULT_LOG_LEVEL: LogLevelDesc = 'info';

export const DEFAULT_MOCK_BACKEND_PORT = 3001;

/**
 * Parses a port from the environment. Written out rather than `Number(x) ||
 * undefined` because port 0 is meaningful — it asks the OS for a free port —
 * and would be lost as falsy.
 * */
const readPort = (value: string | undefined) => {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  const port = Number(value);

  return Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : undefined;
};

/**
 * Environment overrides. `port` and `host` stay undefined unless set, so a
 * config's own values keep precedence — the environment only fills gaps.
 * */
export const getMockEnv = () => ({
  appUri: process.env.MOCKSMITH_APP_URI || DEFAULT_MOCK_APP_URI,
  port: readPort(process.env.MOCKSMITH_PORT),
  host: process.env.MOCKSMITH_HOST || undefined,
  logLevel: (process.env.MOCKSMITH_LOG_LEVEL as LogLevelDesc | undefined) || DEFAULT_LOG_LEVEL,
});
