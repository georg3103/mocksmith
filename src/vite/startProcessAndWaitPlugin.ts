import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

import type { Plugin } from 'vite';

const DEFAULT_HEALTHCHECK_TIMEOUT_MS = 60_000;
const DEFAULT_HEALTHCHECK_POLL_INTERVAL_MS = 250;
const DEFAULT_HEALTHCHECK_REQUEST_TIMEOUT_MS = 2_000;

export type StartProcessAndWaitOptions = {
  /** Plugin name, also used in error messages. */
  name: string;
  command: string;
  args?: string[];
  /** URL polled until the process is ready (the mock server serves /__healthcheck). */
  healthcheckUrl: string;
  enabled?: boolean;
  cwd?: string;
  env?: Record<string, string>;
  healthcheckTimeoutMs?: number;
  healthcheckPollIntervalMs?: number;
};

const wait = async (delayMs: number) => {
  await new Promise<void>((resolve) => {
    const timerId = setTimeout(() => {
      clearTimeout(timerId);
      resolve();
    }, delayMs);
  });
};

const isHealthcheckReady = async (healthcheckUrl: string) => {
  const url = new URL(healthcheckUrl);
  const client = url.protocol === 'https:' ? https : http;

  return await new Promise<boolean>((resolve) => {
    const request = client.request(
      url,
      {
        method: 'GET',
        rejectUnauthorized: false,
      },
      (response) => {
        response.resume();

        resolve(
          Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 500)
        );
      }
    );

    request.setTimeout(DEFAULT_HEALTHCHECK_REQUEST_TIMEOUT_MS, () => {
      request.destroy();
      resolve(false);
    });

    request.on('error', () => {
      resolve(false);
    });

    request.end();
  });
};

const waitForHealthcheck = async ({
  healthcheckUrl,
  name,
  timeoutMs,
  pollIntervalMs,
}: {
  healthcheckUrl: string;
  name: string;
  timeoutMs: number;
  pollIntervalMs: number;
}) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isHealthcheckReady(healthcheckUrl)) {
      return;
    }

    await wait(pollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for ${name}: healthcheck ${healthcheckUrl} did not answer within ${timeoutMs}ms`
  );
};

/**
 * Starts a side process (typically the mock server) together with the Vite dev
 * server and waits for its healthcheck before Vite serves anything. The process
 * is stopped when the dev server closes or the parent exits. If something
 * already answers the healthcheck, no new process is spawned.
 * */
export const startProcessAndWaitPlugin = ({
  name,
  command,
  args = [],
  healthcheckUrl,
  enabled = true,
  cwd = process.cwd(),
  env = {},
  healthcheckTimeoutMs = DEFAULT_HEALTHCHECK_TIMEOUT_MS,
  healthcheckPollIntervalMs = DEFAULT_HEALTHCHECK_POLL_INTERVAL_MS,
}: StartProcessAndWaitOptions): Plugin => {
  let childProcess: ChildProcess | undefined;
  let startupPromise: Promise<void> | undefined;
  let isReady = false;
  let isCleanupRegistered = false;

  const stopChildProcess = () => {
    if (!childProcess || childProcess.killed) {
      return;
    }

    childProcess.kill('SIGTERM');
    childProcess = undefined;
  };

  const registerCleanup = () => {
    if (isCleanupRegistered) {
      return;
    }

    isCleanupRegistered = true;

    process.once('exit', stopChildProcess);
    process.once('SIGINT', stopChildProcess);
    process.once('SIGTERM', stopChildProcess);
  };

  const ensureProcessStarted = async () => {
    if (await isHealthcheckReady(healthcheckUrl)) {
      isReady = true;

      return;
    }

    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'inherit', 'inherit'],
      shell: process.platform === 'win32',
    });

    childProcess = child;

    const childExitPromise = new Promise<never>((_, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => {
        if (isReady) {
          return;
        }

        reject(
          new Error(
            `${name} exited before its healthcheck (${healthcheckUrl}) passed. code=${String(
              code
            )} signal=${String(signal)}`
          )
        );
      });
    });

    await Promise.race([
      waitForHealthcheck({
        healthcheckUrl,
        name,
        timeoutMs: healthcheckTimeoutMs,
        pollIntervalMs: healthcheckPollIntervalMs,
      }),
      childExitPromise,
    ]);

    isReady = true;
  };

  return {
    name,
    enforce: 'pre',
    async configResolved(config) {
      if (!enabled || config.command !== 'serve') {
        return;
      }

      registerCleanup();

      startupPromise ??= ensureProcessStarted();

      await startupPromise;
    },
    configureServer(server) {
      server.httpServer?.once('close', stopChildProcess);
    },
  };
};
