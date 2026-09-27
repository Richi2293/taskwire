import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const launcher = resolve(import.meta.dirname, '..', 'bin', 'taskwire-orchestrator');

test('the launcher prints help, also through a symlink from another directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'orchestrator-bin-'));
  const link = join(dir, 'taskwire-orchestrator');
  symlinkSync(launcher, link);
  for (const command of [launcher, link]) {
    assert.match(execFileSync(command, ['--help'], { encoding: 'utf8', cwd: dir }), /taskwire-orchestrator: let agents work/);
  }
});
