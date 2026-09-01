import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type SelfSignedCert = {
  cert: Buffer;
  key: Buffer;
};

/**
 * Generates a throwaway self-signed certificate for localhost TLS tests.
 * Nothing is committed to the repository — the files live in a temp dir for
 * the duration of the call.
 * */
export const createSelfSignedCert = (): SelfSignedCert => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'mocksmith-cert-'));
  const keyPath = path.join(directory, 'localhost.key');
  const certPath = path.join(directory, 'localhost.crt');

  try {
    execFileSync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ]);

    return { cert: readFileSync(certPath), key: readFileSync(keyPath) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};
