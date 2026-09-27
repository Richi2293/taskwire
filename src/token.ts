import { execFileSync } from 'node:child_process';
import { configError } from './errors.ts';

export const KEYCHAIN_SERVICE = 'taskwire';

export type KeychainReader = (service: string) => string | null;

export const readKeychain: KeychainReader = (service) => {
  if (process.platform !== 'darwin') return null;
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
};

// A named account has its own Keychain service, so a lookup of "taskwire" never returns its token.
export function keychainService(account?: string): string {
  return account === undefined ? KEYCHAIN_SERVICE : `${KEYCHAIN_SERVICE}:${account}`;
}

export function tokenVariable(account?: string): string {
  return account === undefined ? 'TASKWIRE_API_TOKEN' : `TASKWIRE_API_TOKEN_${account.toUpperCase().replaceAll('-', '_')}`;
}

// With an account there is no fallback to the default token: using the wrong account would be worse than an error.
export function resolveToken(
  readKc: KeychainReader,
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
  account?: string,
): string {
  const service = keychainService(account);
  const variable = tokenVariable(account);
  const fromKeychain = readKc(service)?.trim();
  if (fromKeychain) return fromKeychain;
  const fromEnv = env[variable]?.trim();
  if (fromEnv) return fromEnv;
  // The Keychain is read only on macOS, so elsewhere the environment variable is the only way.
  const hint =
    platform === 'darwin'
      ? `Save it in the Keychain with: security add-generic-password -a "$USER" -s ${service} -w (or set ${variable})`
      : `Set the ${variable} environment variable`;
  const message = account === undefined ? 'No ClickUp token found' : `No ClickUp token found for account "${account}"`;
  throw configError(message, hint);
}
