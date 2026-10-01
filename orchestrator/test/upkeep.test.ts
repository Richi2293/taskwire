import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMerges, writeMerges } from '../src/merges.ts';
import { upkeep } from '../src/upkeep.ts';
import { fakeCommands, fakeTaskwire, task, tempDir } from './helpers.ts';

const entry = { project: '/p/shop', task: 't1', name: 'Add a discount', branch: 'feat/discount', pr: 12, url: 'u', sha: 'abc123', queuedAt: '2026-09-27T09:00:00.000Z' };

function deps(home: string) {
  const commands = fakeCommands({ gh: () => ({ code: 127, stderr: 'spawn gh ENOENT' }) });
  const taskwire = fakeTaskwire({ 'task get': { ...task({ status: 'qa' }), needs: 'review' }, 'task update': {}, 'comment add': { id: 'c1' } });
  return { commands, deps: { home, runTaskwire: taskwire.run, runCommand: commands.run, now: () => Date.parse('2026-09-27T10:00:00.000Z') } };
}

test('without work allowed the merge queue is left alone; with it the queue is handled', async () => {
  const home = tempDir('home');
  writeMerges(home, [entry]);
  const paused = deps(home);
  await upkeep(paused.deps, { path: '/p/shop', merge: 'dev' }, false);
  assert.equal(readMerges(home).length, 1);
  assert.equal(paused.commands.calls.filter((call) => call.command === 'gh').length, 0);
  const working = deps(home);
  await upkeep(working.deps, { path: '/p/shop', merge: 'dev' }, true);
  assert.deepEqual(readMerges(home), []);
});
