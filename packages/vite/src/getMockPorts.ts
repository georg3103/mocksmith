import detectPort from 'detect-port';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rmdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_APP_PORT = 3000;
const DEFAULT_BACKEND_PORT = 3001;
const PORT_PAIR_STEP = 2;
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;
const STALE_LOCK_TIMEOUT_MS = 30_000;
const RESERVATION_STARTUP_TIMEOUT_MS = 60_000;
const RESERVATION_POLL_INTERVAL_MS = 500;

const registryPath = path.join(os.tmpdir(), 'mocksmith-port-reservations.json');
const registryLockPath = path.join(os.tmpdir(), 'mocksmith-port-reservations.lock');

type PortPair = {
  appPort: number;
  backendPort: number;
};

type Reservation = PortPair & {
  id: string;
  pid: number;
  createdAt: number;
};

const wait = (delayMs: number) =>
  new Promise<void>((resolve) => {
    const timerId = setTimeout(() => {
      clearTimeout(timerId);
      resolve();
    }, delayMs);
  });

const getUriPort = (uri?: string) => {
  try {
    return Number(new URL(uri as string).port);
  } catch {
    return 0;
  }
};

const isPidAlive = (pid: number) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
};

const isValidReservation = (reservation: unknown): reservation is Reservation => {
  const candidate = reservation as Partial<Reservation> | null;

  return (
    typeof candidate?.id === 'string' &&
    Number.isInteger(candidate.pid) &&
    Number.isFinite(candidate.createdAt) &&
    Number.isInteger(candidate.appPort) &&
    Number.isInteger(candidate.backendPort)
  );
};

const isPortFree = async (port: number) => {
  const detectedPort = await detectPort(port);

  if (!Number.isInteger(detectedPort)) {
    throw new Error(`Could not check availability of port ${port}`);
  }

  return detectedPort === port;
};

const arePortsFree = async ({ appPort, backendPort }: PortPair) => {
  const [isAppPortFree, isBackendPortFree] = await Promise.all([
    isPortFree(appPort),
    isPortFree(backendPort),
  ]);

  return isAppPortFree && isBackendPortFree;
};

const readRegistry = async (): Promise<Reservation[]> => {
  try {
    const registry: unknown = JSON.parse(await readFile(registryPath, 'utf8'));

    return Array.isArray(registry) ? registry.filter(isValidReservation) : [];
  } catch {
    return [];
  }
};

const writeRegistry = async (registry: Reservation[]) => {
  const temporaryPath = `${registryPath}.${process.pid}.${randomUUID()}`;

  await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`);
  await rename(temporaryPath, registryPath);
};

const releaseStaleRegistryLock = async () => {
  try {
    const lockStat = await stat(registryLockPath);

    if (Date.now() - lockStat.mtimeMs > STALE_LOCK_TIMEOUT_MS) {
      await rmdir(registryLockPath);
    }
  } catch {
    // The lock was already released by another process.
  }
};

const acquireRegistryLock = async () => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < LOCK_TIMEOUT_MS) {
    try {
      await mkdir(registryLockPath);

      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') {
        throw error;
      }

      await releaseStaleRegistryLock();
      await wait(LOCK_RETRY_DELAY_MS);
    }
  }

  throw new Error('Could not acquire the lock for mock port selection');
};

const withRegistryLock = async <T>(callback: () => Promise<T>): Promise<T> => {
  await acquireRegistryLock();

  try {
    return await callback();
  } finally {
    await rmdir(registryLockPath).catch(() => undefined);
  }
};

const cleanupRegistry = async (registry: Reservation[]) => {
  const now = Date.now();
  const reservations = await Promise.all(
    registry.map(async (reservation) => {
      const portsAreFree = await arePortsFree(reservation);
      const ownerIsAlive = isPidAlive(reservation.pid);
      const startupTimeoutExpired = now - reservation.createdAt > RESERVATION_STARTUP_TIMEOUT_MS;

      if (portsAreFree && (!ownerIsAlive || startupTimeoutExpired)) {
        return undefined;
      }

      return reservation;
    })
  );

  return reservations.filter(Boolean) as Reservation[];
};

const getAvailablePortPair = async (
  preferredAppPort: number,
  preferredBackendPort: number,
  reservations: Reservation[]
): Promise<PortPair> => {
  const reservedPorts = new Set(
    reservations.flatMap(({ appPort, backendPort }) => [appPort, backendPort])
  );
  let appPort = preferredAppPort;
  let backendPort = preferredBackendPort;

  while (appPort <= 65_534 && backendPort <= 65_535) {
    const portsAreReserved = reservedPorts.has(appPort) || reservedPorts.has(backendPort);

    if (!portsAreReserved && (await arePortsFree({ appPort, backendPort }))) {
      return { appPort, backendPort };
    }

    appPort += PORT_PAIR_STEP;
    backendPort += PORT_PAIR_STEP;
  }

  throw new Error('Could not find a free port pair for the mock app');
};

const reservePortPair = async (preferredAppPort: number, preferredBackendPort: number) =>
  withRegistryLock(async () => {
    const registry = await cleanupRegistry(await readRegistry());
    const ports = await getAvailablePortPair(preferredAppPort, preferredBackendPort, registry);
    const reservation: Reservation = {
      id: randomUUID(),
      pid: process.pid,
      createdAt: Date.now(),
      ...ports,
    };

    await writeRegistry([...registry, reservation]);

    return reservation;
  });

const releaseReservation = async (reservationId: string) => {
  await withRegistryLock(async () => {
    const registry = await readRegistry();
    const updatedRegistry = registry.filter(({ id }) => id !== reservationId);

    if (updatedRegistry.length !== registry.length) {
      await writeRegistry(updatedRegistry);
    }
  });
};

const monitorReservation = (reservation: Reservation) => {
  let hasOccupiedPort = false;
  let isChecking = false;

  const timerId = setInterval(async () => {
    if (isChecking) {
      return;
    }

    isChecking = true;

    try {
      const portsAreFree = await arePortsFree(reservation);

      if (!portsAreFree) {
        hasOccupiedPort = true;
      } else if (hasOccupiedPort) {
        clearInterval(timerId);
        await releaseReservation(reservation.id);
      }
    } catch {
      // A transient failure is retried on the next tick.
    } finally {
      isChecking = false;
    }
  }, RESERVATION_POLL_INTERVAL_MS);

  timerId.unref();
};

export type GetMockPortsOptions = {
  /**
   * Scheme for the returned URIs. Both the mock server and the Vite dev server
   * speak http unless you configure TLS, so http is the default — a URI that
   * claims https makes the healthcheck open a TLS handshake against a plain
   * HTTP port, which never succeeds.
   * */
  protocol?: 'http' | 'https';
  /** Hostname for the returned URIs. Keep it the same everywhere: cookies treat
   * `localhost` and `127.0.0.1` as different hosts, and the Playwright fixture
   * binds its session cookie to the app's host. */
  host?: string;
};

/**
 * Reserves a free (app, mock backend) port pair for a dev session and returns
 * the environment variables describing it. Reservations live in a lock-guarded
 * registry in the OS temp dir, so parallel dev servers never collide.
 * Returns the preferred ports as is under CI or when already resolved.
 * */
export const getMockPortsEnv = async ({
  protocol = 'http',
  host = 'localhost',
}: GetMockPortsOptions = {}): Promise<Record<string, string>> => {
  const shouldDetectPorts =
    !process.env.CI && process.env.MOCKSMITH_PORTS_RESOLVED !== 'true';
  const preferredAppPort =
    Number(process.env.PORT) || getUriPort(process.env.MOCKSMITH_APP_URI) || DEFAULT_APP_PORT;
  const preferredBackendPort =
    Number(process.env.MOCKSMITH_PORT) ||
    getUriPort(process.env.MOCKSMITH_URI) ||
    (preferredAppPort === DEFAULT_APP_PORT ? DEFAULT_BACKEND_PORT : preferredAppPort + 1);
  const reservation = shouldDetectPorts
    ? await reservePortPair(preferredAppPort, preferredBackendPort)
    : undefined;
  const { appPort, backendPort } = reservation ?? {
    appPort: preferredAppPort,
    backendPort: preferredBackendPort,
  };

  if (reservation) {
    monitorReservation(reservation);
  }

  return {
    MOCKSMITH_PORTS_RESOLVED: 'true',
    PORT: String(appPort),
    MOCKSMITH_PORT: String(backendPort),
    MOCKSMITH_URI: `${protocol}://${host}:${backendPort}`,
    MOCKSMITH_APP_URI: `${protocol}://${host}:${appPort}`,
  };
};
