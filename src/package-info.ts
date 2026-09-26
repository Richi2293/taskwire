import { readFileSync } from 'node:fs';

export interface PackageInfo {
  name: string;
  version: string;
}

// package.json sits one level up both from src/ and from the compiled dist/ of the npm package.
const PACKAGE_URL = new URL('../package.json', import.meta.url);

export function packageInfo(): PackageInfo {
  const data = JSON.parse(readFileSync(PACKAGE_URL, 'utf8')) as { name?: unknown; version?: unknown };
  return {
    name: typeof data.name === 'string' ? data.name : 'taskwire',
    version: typeof data.version === 'string' ? data.version : 'unknown',
  };
}
