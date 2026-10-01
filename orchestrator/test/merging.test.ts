import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readMerges, writeMerges } from '../src/merges.ts';
import type { PendingMerge } from '../src/merges.ts';
import { tempDir } from './helpers.ts';

function pending(overrides: Partial<PendingMerge> = {}): PendingMerge {
  return { project: '/p/shop', task: 't1', name: 'Add a discount', branch: 'feat/discount', pr: 12, url: 'https://github.com/acme/shop/pull/12', queuedAt: '2026-09-27T10:00:00.000Z', ...overrides };
}

test('the merge queue is kept on disk, and a broken file reads as empty', () => {
  const home = tempDir('home');
  assert.deepEqual(readMerges(home), []);
  writeMerges(home, [pending()]);
  assert.deepEqual(readMerges(home), [pending()]);
  writeFileSync(join(home, 'merges.json'), '{ cut');
  assert.deepEqual(readMerges(home), []);
});
