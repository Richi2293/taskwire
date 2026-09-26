#!/usr/bin/env node
import { main } from './cli.ts';
import { readKeychain } from './token.ts';

process.exitCode = await main({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  stdout: process.stdout,
  stderr: process.stderr,
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
  readKeychain,
});
