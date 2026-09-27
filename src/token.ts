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

export function resolveToken(
  readKc: KeychainReader,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): string {
  const fromKeychain = readKc()?.trim();
  if (fromKeychain) return fromKeychain;
  const fromEnv = env.TASKWIRE_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  // The Keychain is read only on macOS, so elsewhere the environment variable is the only way.
  const hint =
    platform === 'darwin'
      ? `Save it in the Keychain with: security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w (or set TASKWIRE_API_TOKEN)`
      : 'Set the TASKWIRE_API_TOKEN environment variable';
  throw configError('No ClickUp token found', hint);
}
