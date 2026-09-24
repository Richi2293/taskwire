import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_FILE, findConfig, parseConfig, writeConfig } from '../src/config.ts';
import { TaskwireError } from '../src/errors.ts';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'taskwire-config-'));
}

test('finds the config in a parent directory', () => {
  const root = tempDir();
  writeFileSync(join(root, CONFIG_FILE), JSON.stringify({ folderId: '123', defaultListId: '456' }));
  const nested = join(root, 'src', 'deep');
  mkdirSync(nested, { recursive: true });
  const found = findConfig(nested);
  assert.deepEqual(found, {
    path: join(root, CONFIG_FILE),
    config: { provider: 'clickup', folderId: '123', defaultListId: '456' },
  });
});

test('returns null when no config exists up to the root', () => {
  assert.equal(findConfig(tempDir()), null);
});

test('rejects invalid JSON with a config error', () => {
  assert.throws(() => parseConfig('{nope', '/x/.taskwire.json'), (e: unknown) => e instanceof TaskwireError && e.exitCode === 3);
});

test('rejects a non numeric folderId', () => {
  assert.throws(() => parseConfig('{"folderId":"abc"}', '/x'), (e: unknown) => e instanceof TaskwireError && e.exitCode === 3);
  assert.throws(() => parseConfig('{"folderId":123}', '/x'), (e: unknown) => e instanceof TaskwireError && e.exitCode === 3);
});

test('rejects a non numeric defaultListId', () => {
  assert.throws(() => parseConfig('{"folderId":"1","defaultListId":"x"}', '/x'), (e: unknown) => e instanceof TaskwireError);
});

test('drops unknown keys', () => {
  assert.deepEqual(parseConfig('{"folderId":"1","extra":true}', '/x'), { provider: 'clickup', folderId: '1' });
});

test('accepts an explicit clickup provider', () => {
  assert.deepEqual(parseConfig('{"provider":"clickup","folderId":"1"}', '/x'), { provider: 'clickup', folderId: '1' });
});

test('rejects an unsupported provider with a config error listing the supported ones', () => {
  assert.throws(() => parseConfig('{"provider":"jira","folderId":"1"}', '/x'), (e: unknown) =>
    e instanceof TaskwireError && e.exitCode === 3 && (e.hint ?? '').includes('clickup'));
});

test('writeConfig writes pretty JSON and refuses to overwrite without force', () => {
  const dir = tempDir();
  const path = writeConfig(dir, { provider: 'clickup', folderId: '1' }, false);
  assert.equal(readFileSync(path, 'utf8'), '{\n  "provider": "clickup",\n  "folderId": "1"\n}\n');
  assert.throws(() => writeConfig(dir, { provider: 'clickup', folderId: '2' }, false), (e: unknown) =>
    e instanceof TaskwireError && e.exitCode === 2);
  writeConfig(dir, { provider: 'clickup', folderId: '2' }, true);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { provider: 'clickup', folderId: '2' });
});

test('accepts an optional numeric workspaceId', () => {
  assert.deepEqual(parseConfig('{"workspaceId":"5","folderId":"1"}', '/x'), { provider: 'clickup', workspaceId: '5', folderId: '1' });
});

test('rejects a non numeric workspaceId', () => {
  assert.throws(() => parseConfig('{"workspaceId":"abc","folderId":"1"}', '/x'), (e: unknown) =>
    e instanceof TaskwireError && e.exitCode === 3);
});

test('parses optional task conventions', () => {
  assert.deepEqual(parseConfig('{"folderId":"1","conventions":{"language":"Italian","instructions":"Short names."}}', '/x'), {
    provider: 'clickup',
    folderId: '1',
    conventions: { language: 'Italian', instructions: 'Short names.' },
  });
});

test('drops unknown and empty convention keys', () => {
  assert.deepEqual(parseConfig('{"folderId":"1","conventions":{"language":"English","extra":true}}', '/x'), {
    provider: 'clickup',
    folderId: '1',
    conventions: { language: 'English' },
  });
  assert.deepEqual(parseConfig('{"folderId":"1","conventions":{}}', '/x'), { provider: 'clickup', folderId: '1' });
});

test('rejects conventions that are not an object of non empty strings', () => {
  for (const conventions of ['"Italian"', '[]', 'null', '{"language":3}', '{"language":" "}', '{"instructions":false}']) {
    assert.throws(() => parseConfig(`{"folderId":"1","conventions":${conventions}}`, '/x'), (e: unknown) =>
      e instanceof TaskwireError && e.exitCode === 3, conventions);
  }
});
