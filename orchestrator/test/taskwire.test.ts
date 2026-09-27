import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTaskwire } from '../src/taskwire.ts';
import { tempDir } from './helpers.ts';

// A stand-in for the taskwire CLI: prints its arguments and folder as JSON, or fails like taskwire does.
function fakeCli(): string {
  const path = join(tempDir('bin'), 'taskwire');
  writeFileSync(path, `#!/usr/bin/env node
if (process.argv[2] === 'fail') {
  process.stderr.write(JSON.stringify({ error: 'Task t9 is not in this project', hint: 'Check the id' }) + '\\n');
  process.exit(3);
}
process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
`);
  chmodSync(path, 0o755);
  return path;
}

test('runs the taskwire command in the project folder and parses its JSON', async () => {
  const run = createTaskwire(fakeCli());
  // The child process sees the real path (on macOS the temporary folder is behind a symlink).
  const dir = realpathSync(tempDir('project'));
  const result = await run(['task', 'get', 't1', '--comments', '0'], dir);
  assert.deepEqual(result, { args: ['task', 'get', 't1', '--comments', '0'], cwd: dir });
});

test('turns a taskwire error into an error with its message, hint and exit code', async () => {
  const run = createTaskwire(fakeCli());
  await assert.rejects(run(['fail'], tempDir('project')), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /taskwire fail: Task t9 is not in this project \(Check the id\)/);
    assert.equal((error as { exitCode?: number }).exitCode, 3);
    return true;
  });
});
