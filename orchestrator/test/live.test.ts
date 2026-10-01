import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectEntry } from '../src/config.ts';
import { readLive, trackLive } from '../src/live.ts';
import type { CommandCall } from './helpers.ts';
import { fakeCommands, fakeTaskwire, tempDir } from './helpers.ts';

const shop: ProjectEntry = { path: '/p/shop' };
const NOW = Date.parse('2026-09-27T10:00:00.000Z');

function recordRun(home: string, fields: Record<string, unknown>): void {
  const run = { project: '/p/shop', task: 't1', name: 'Add a discount', url: 'https://app.clickup.com/t/t1', startedAt: '2026-09-27T08:00:00.000Z', finishedAt: '2026-09-27T09:00:00.000Z', durationMs: 1, costUsd: null, needs: 'review', status: 'qa', summary: '', tests: null, verdict: 'pass', worktree: '/wt', log: '/l', branch: 'feat/discount', pr: 12, sha: 'abc123', ...fields };
  appendFileSync(join(home, 'runs.jsonl'), `${JSON.stringify(run)}\n`);
}

function world(home: string, pr: Record<string, unknown>, options: { inProduction?: boolean; fetch?: number } = {}) {
  const events: Record<string, unknown>[] = [];
  const commands = fakeCommands({
    'git symbolic-ref': () => ({ stdout: 'origin/main\n' }),
    'git fetch': () => ({ code: options.fetch ?? 0 }),
    'git merge-base': () => ({ code: options.inProduction === false ? 1 : 0 }),
    'gh pr': () => ({ stdout: JSON.stringify({ number: 12, url: 'u', state: 'MERGED', baseRefName: 'dev', headRefName: 'feat/discount', headRefOid: 'abc123', mergedAt: '2026-09-27T09:30:00Z', mergeCommit: { oid: 'm42' }, createdAt: '2026-09-27T09:00:00Z', mergeable: 'UNKNOWN', statusCheckRollup: [], ...pr }) }),
  });
  const deps = { home, runTaskwire: fakeTaskwire({}).run, runCommand: commands.run, now: () => NOW, log: (event: Record<string, unknown>) => events.push(event) };
  return { commands, events, deps };
}

const ghViews = (calls: CommandCall[]) => calls.filter((call) => call.command === 'gh').length;

test('a task whose pull request is merged and in production becomes live, once', async () => {
  const home = tempDir('home');
  recordRun(home, {});
  const run = world(home, {});
  await trackLive(run.deps, shop);
  assert.deepEqual(readLive(home).live.map((entry) => [entry.task, entry.name, entry.url, entry.pr]), [['t1', 'Add a discount', 'https://app.clickup.com/t/t1', 12]]);
  assert.equal(run.events.find((event) => event.event === 'live')?.task, 't1');
  assert.deepEqual(run.commands.calls.find((call) => call.command === 'git' && call.args[0] === 'merge-base')?.args, ['merge-base', '--is-ancestor', 'm42', 'origin/main']);
  const again = world(home, {});
  await trackLive(again.deps, shop);
  assert.equal(ghViews(again.commands.calls), 0);
  assert.equal(readLive(home).live.length, 1);
});

test('a pull request merged into staging only is asked once; then its merge commit is checked locally', async () => {
  const home = tempDir('home');
  recordRun(home, {});
  await trackLive(world(home, {}, { inProduction: false }).deps, shop);
  assert.deepEqual(readLive(home).live, []);
  const again = world(home, {}, { inProduction: true });
  await trackLive(again.deps, shop);
  assert.equal(ghViews(again.commands.calls), 0);
  assert.deepEqual(readLive(home).live.map((entry) => entry.task), ['t1']);
});

test('an open pull request is asked again only after a while', async () => {
  const home = tempDir('home');
  recordRun(home, {});
  const open = { state: 'OPEN', mergedAt: null, mergeCommit: null };
  await trackLive(world(home, open).deps, shop);
  const soon = world(home, open);
  await trackLive(soon.deps, shop);
  assert.equal(ghViews(soon.commands.calls), 0);
  const later = world(home, open);
  await trackLive({ ...later.deps, now: () => NOW + 31 * 60_000 }, shop);
  assert.equal(ghViews(later.commands.calls), 1);
});

test('a pull request closed without merging is never asked again', async () => {
  const home = tempDir('home');
  recordRun(home, {});
  await trackLive(world(home, { state: 'CLOSED', mergedAt: null, mergeCommit: null }).deps, shop);
  const again = world(home, {});
  await trackLive(again.deps, shop);
  assert.equal(ghViews(again.commands.calls), 0);
  assert.deepEqual(readLive(home).live, []);
});

test('old runs, runs without a pull request and an unreachable remote ask nothing', async () => {
  const home = tempDir('home');
  recordRun(home, { task: 'old', finishedAt: '2026-08-01T09:00:00.000Z' });
  recordRun(home, { task: 'nopr', pr: null });
  const run = world(home, {});
  await trackLive(run.deps, shop);
  assert.equal(run.commands.calls.length, 0);
  recordRun(home, {});
  const offline = world(home, {}, { fetch: 128 });
  await trackLive(offline.deps, shop);
  assert.equal(ghViews(offline.commands.calls), 0);
});

test('only the latest run of a task counts', async () => {
  const home = tempDir('home');
  recordRun(home, { pr: 10 });
  recordRun(home, { pr: 12, finishedAt: '2026-09-27T09:40:00.000Z' });
  const run = world(home, {});
  await trackLive(run.deps, shop);
  assert.deepEqual(run.commands.calls.filter((call) => call.command === 'gh').map((call) => call.args[2]), ['12']);
});
