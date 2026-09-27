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

test('without an account, reads the Keychain service "taskwire"', () => {
  const services: string[] = [];
  resolveToken((service) => { services.push(service); return 'pk_kc'; }, {});
  assert.deepEqual(services, ['taskwire']);
});

test('with an account, reads its own Keychain service first, then its own environment variable', () => {
  const byService: Record<string, string> = { taskwire: 'pk_default', 'taskwire:acme-corp': 'pk_acme' };
  assert.equal(resolveToken((service) => byService[service] ?? null, {}, 'darwin', 'acme-corp'), 'pk_acme');
  const env = { TASKWIRE_API_TOKEN: 'pk_default', TASKWIRE_API_TOKEN_ACME_CORP: 'pk_acme_env' };
  assert.equal(resolveToken(() => null, env, 'linux', 'acme-corp'), 'pk_acme_env');
});

test('with an account and no token of its own, never falls back to the default token', () => {
  assert.throws(
    () => resolveToken((service) => (service === 'taskwire' ? 'pk_default' : null), { TASKWIRE_API_TOKEN: 'pk_default' }, 'darwin', 'acme'),
    (error: unknown) =>
      error instanceof TaskwireError &&
      error.exitCode === 3 &&
      error.message.includes('"acme"') &&
      (error.hint ?? '').includes('security add-generic-password -a "$USER" -s taskwire:acme -w') &&
      (error.hint ?? '').includes('TASKWIRE_API_TOKEN_ACME'),
  );
});
