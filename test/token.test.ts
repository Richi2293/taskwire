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

test('on macOS, throws a config error with the Keychain command when no token exists', () => {
  assert.throws(
    () => resolveToken(() => null, {}, 'darwin'),
    (error: unknown) =>
      error instanceof TaskwireError &&
      error.exitCode === 3 &&
      (error.hint ?? '').includes('security add-generic-password -a "$USER" -s taskwire -w'),
  );
});

test('outside macOS, the missing token error suggests only TASKWIRE_API_TOKEN', () => {
  for (const platform of ['linux', 'win32'] as const) {
    assert.throws(
      () => resolveToken(() => null, {}, platform),
      (error: unknown) =>
        error instanceof TaskwireError &&
        error.exitCode === 3 &&
        (error.hint ?? '').includes('TASKWIRE_API_TOKEN') &&
        !(error.hint ?? '').includes('Keychain'),
    );
  }
});
