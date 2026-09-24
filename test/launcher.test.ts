import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const launcher = resolve(import.meta.dirname, '..', 'bin', 'taskwire');

test('the launcher prints help', () => {
  assert.match(execFileSync(launcher, ['--help'], { encoding: 'utf8' }), /taskwire: manage the tasks of this project/);
});

test('the launcher works through a symlink from another directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taskwire-bin-'));
  const link = join(dir, 'taskwire');
  symlinkSync(launcher, link);
  assert.match(execFileSync(link, ['--help'], { encoding: 'utf8', cwd: dir }), /taskwire: manage the tasks of this project/);
});
