import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectEntry } from '../src/config.ts';
import { readMerges, writeMerges } from '../src/merges.ts';
import type { PendingMerge } from '../src/merges.ts';
import { processMerges } from '../src/merging.ts';
import { fakeCommands, fakeTaskwire, task, tempDir } from './helpers.ts';

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

const shop: ProjectEntry = { path: '/p/shop', merge: 'dev' };
const NOW = Date.parse('2026-09-27T10:05:00.000Z');

function deps(home: string, gh: Record<string, unknown>, needs: string | null = 'review', mergeCode = 0) {
  const taskwire = fakeTaskwire({ 'task get': { ...task({ status: 'qa' }), needs }, 'task update': {}, 'comment add': { id: 'c1' } });
  const events: Record<string, unknown>[] = [];
  const commands = fakeCommands({
    'gh pr': (call) => (call.args[1] === 'merge'
      ? { code: mergeCode, stderr: mergeCode === 0 ? '' : 'merge refused' }
      : { stdout: JSON.stringify({ number: 12, url: 'https://github.com/acme/shop/pull/12', state: 'OPEN', baseRefName: 'dev', headRefName: 'feat/discount', mergeable: 'MERGEABLE', statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }], ...gh }) }),
  });
  return { taskwire, commands, events, deps: { home, runTaskwire: taskwire.run, runCommand: commands.run, now: () => NOW, log: (event: Record<string, unknown>) => events.push(event) } };
}

const merged = (calls: { args: string[] }[]) => calls.some((call) => call.args[1] === 'merge');
const lines = (calls: { args: string[] }[]) => calls.map((call) => call.args.join(' '));

test('a queued task with green checks is merged, its mark cleared and a comment added', async () => {
  const home = tempDir('home');
  writeMerges(home, [pending()]);
  const run = deps(home, {});
  await processMerges(run.deps, shop);
  assert.ok(merged(run.commands.calls));
  assert.deepEqual(readMerges(home), []);
  assert.ok(lines(run.taskwire.calls).includes('task update t1 --needs none'));
  assert.ok(lines(run.taskwire.calls).some((line) => line.startsWith('comment add t1') && line.includes('merged into `dev` by the orchestrator')));
  assert.equal(run.events.find((event) => event.event === 'merge')?.pr, 12);
});

test('pending checks or an unknown mergeable state keep the task in the queue', async () => {
  for (const gh of [{ statusCheckRollup: [{ __typename: 'CheckRun', status: 'IN_PROGRESS' }] }, { mergeable: 'UNKNOWN' }]) {
    const home = tempDir('home');
    writeMerges(home, [pending()]);
    const run = deps(home, gh);
    await processMerges(run.deps, shop);
    assert.equal(merged(run.commands.calls), false);
    assert.equal(readMerges(home).length, 1);
  }
});

test('no checks: wait a while after the pull request is opened, then hand the task to the person', async () => {
  const home = tempDir('home');
  writeMerges(home, [pending({ queuedAt: '2026-09-27T10:00:00.000Z' })]);
  const early = deps(home, { statusCheckRollup: [] });
  await processMerges(early.deps, shop);
  assert.equal(readMerges(home).length, 1);
  const late = deps(home, { statusCheckRollup: [] });
  await processMerges({ ...late.deps, now: () => NOW + 10 * 60_000 }, shop);
  assert.deepEqual(readMerges(home), []);
  assert.ok(lines(late.taskwire.calls).some((line) => line.startsWith('comment add t1') && line.includes('no CI checks')));
});

test('failed checks, conflicts, a wrong base or a refused merge hand the task to the person with the reason', async () => {
  const cases: [Record<string, unknown>, number, string][] = [
    [{ statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }] }, 0, 'CI of the pull request failed'],
    [{ mergeable: 'CONFLICTING' }, 0, 'conflicts with dev'],
    [{ baseRefName: 'main' }, 0, 'targets main'],
    [{}, 1, 'merge refused'],
  ];
  for (const [gh, mergeCode, reason] of cases) {
    const home = tempDir('home');
    writeMerges(home, [pending()]);
    const run = deps(home, gh, 'review', mergeCode);
    await processMerges(run.deps, shop);
    assert.deepEqual(readMerges(home), []);
    assert.ok(lines(run.taskwire.calls).includes('task update t1 --needs review'), reason);
    assert.ok(lines(run.taskwire.calls).some((line) => line.startsWith('comment add t1') && line.includes(reason)), reason);
  }
});

test('a lowered level, a task changed by the person or a manual merge drop the entry without merging', async () => {
  const cases: [ProjectEntry, Record<string, unknown>, string | null, string][] = [
    [{ path: '/p/shop' }, {}, 'review', 'PR only'],
    [shop, {}, null, 'changed since it was verified'],
    [shop, { state: 'MERGED' }, 'review', 'already merged by a person'],
  ];
  for (const [project, gh, needs, reason] of cases) {
    const home = tempDir('home');
    writeMerges(home, [pending()]);
    const run = deps(home, gh, needs);
    await processMerges(run.deps, project);
    assert.equal(merged(run.commands.calls), false, reason);
    assert.deepEqual(readMerges(home), [], reason);
    assert.ok(String(run.events.find((event) => event.event === 'merge-skipped')?.reason).includes(reason), reason);
    assert.equal(lines(run.taskwire.calls).some((line) => line.startsWith('comment add')), false, reason);
  }
});

test('gh failing hands the task to the person with the error, and other projects are left alone', async () => {
  const home = tempDir('home');
  writeMerges(home, [pending(), pending({ project: '/p/blog', task: 't9' })]);
  const run = deps(home, {});
  await processMerges({ ...run.deps, runCommand: fakeCommands({ gh: () => ({ code: 127, stderr: 'spawn gh ENOENT' }) }).run }, shop);
  assert.deepEqual(readMerges(home).map((entry) => entry.task), ['t9']);
  assert.ok(lines(run.taskwire.calls).some((line) => line.startsWith('comment add t1') && line.includes('spawn gh ENOENT')));
});
