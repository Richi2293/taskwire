import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveToken } from '../src/token.ts';
import { TaskwireError } from '../src/errors.ts';

test('uses the Keychain value first, trimmed', () => {
  assert.equal(resolveToken(() => 'pk_kc\n', { TASKWIRE_API_TOKEN: 'pk_env' }), 'pk_kc');
});

test('falls back to TASKWIRE_API_TOKEN when the Keychain has nothing', () => {
  assert.equal(resolveToken(() => null, { TASKWIRE_API_TOKEN: ' pk_env ' }), 'pk_env');
});

test('ignores an empty Keychain value', () => {
  assert.equal(resolveToken(() => '  ', { TASKWIRE_API_TOKEN: 'pk_env' }), 'pk_env');
});

test('throws a config error with the save command when no token exists', () => {
  assert.throws(
    () => resolveToken(() => null, {}),
    (error: unknown) =>
      error instanceof TaskwireError &&
      error.exitCode === 3 &&
      (error.hint ?? '').includes('security add-generic-password -a "$USER" -s taskwire -w'),
  );
});
