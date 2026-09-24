import { execFileSync } from 'node:child_process';
import { configError } from './errors.ts';

export const KEYCHAIN_SERVICE = 'taskwire';

export type KeychainReader = () => string | null;

export const readKeychain: KeychainReader = () => {
  if (process.platform !== 'darwin') return null;
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
};

export function resolveToken(readKc: KeychainReader, env: Record<string, string | undefined>): string {
  const fromKeychain = readKc()?.trim();
  if (fromKeychain) return fromKeychain;
  const fromEnv = env.TASKWIRE_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  throw configError(
    'No ClickUp token found',
    `Save it in the Keychain with: security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w (or set TASKWIRE_API_TOKEN)`,
  );
}
