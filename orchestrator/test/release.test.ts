import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectEntry } from '../src/config.ts';
import { readReleases } from '../src/releases.ts';
import { processRelease } from '../src/release.ts';
import type { CommandCall } from './helpers.ts';
import { fakeCommands, fakeTaskwire, task, tempDir } from './helpers.ts';

const shop: ProjectEntry = { path: '/p/shop', merge: 'main' };
const NOW = Date.parse('2026-09-27T10:05:00.000Z');

interface Scenario {
  ahead?: number;
  fetch?: number;
  staging?: string;
  // The open release pull request; null when there is none.
  pr?: Record<string, unknown> | null;
  waitingTests?: ReturnType<typeof task>[];
  mergeCode?: number;
  // The state of a pull request read by number.
  viewState?: string;
}

function releasePr(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number: 30,
    url: 'https://github.com/acme/shop/pull/30',
    state: 'OPEN',
    baseRefName: 'main',
    headRefName: 'dev',
    headRefOid: 'dev777',
    mergedAt: null,
    mergeCommit: null,
    createdAt: '2026-09-27T09:00:00Z',
    mergeable: 'MERGEABLE',
    statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ...overrides,
  };
}

function world(home: string, scenario: Scenario = {}) {
  const taskwire = fakeTaskwire({ 'tasks --needs test': scenario.waitingTests ?? [] });
  const events: Record<string, unknown>[] = [];
  const commands = fakeCommands({
    'git symbolic-ref': () => ({ stdout: 'origin/main\n' }),
    'git fetch': () => ({ code: scenario.fetch ?? 0 }),
    'git rev-list': () => ({ stdout: `${scenario.ahead ?? 2}\n` }),
    'git rev-parse': () => ({ stdout: `${scenario.staging ?? 'dev777'}\n` }),
    'gh pr': (call: CommandCall) => {
      if (call.args[1] === 'list') return { stdout: JSON.stringify(scenario.pr === null || scenario.pr === undefined ? [] : [scenario.pr]) };
      if (call.args[1] === 'view') return { stdout: JSON.stringify(releasePr({ state: scenario.viewState ?? 'OPEN' })) };
      if (call.args[1] === 'merge') return { code: scenario.mergeCode ?? 0, stderr: scenario.mergeCode ? 'merge refused' : '' };
      return {};
    },
  });
  const deps = { home, runTaskwire: taskwire.run, runCommand: commands.run, now: () => NOW, log: (event: Record<string, unknown>) => events.push(event) };
  return { taskwire, commands, events, deps };
}

const ghCalls = (calls: CommandCall[]) => calls.filter((call) => call.command === 'gh').map((call) => call.args.slice(0, 2).join(' '));

test('a project below level main never releases, and a project without staging has nothing to release', async () => {
  for (const project of [{ path: '/p/shop', merge: 'dev' as const }, { ...shop, stagingBranch: 'main' }]) {
    const home = tempDir('home');
    const run = world(home);
    await processRelease(run.deps, project);
    assert.deepEqual(ghCalls(run.commands.calls), []);
    assert.deepEqual(readReleases(home), {});
  }
});

test('nothing to release, or a remote that cannot be reached, opens no pull request', async () => {
  for (const scenario of [{ ahead: 0 }, { fetch: 128 }]) {
    const home = tempDir('home');
    const run = world(home, scenario);
    await processRelease(run.deps, shop);
    assert.deepEqual(ghCalls(run.commands.calls), []);
  }
});

test('a task of the project waiting for a test by hand holds the release; tasks of other areas do not', async () => {
  const home = tempDir('home');
  const waiting = world(home, { waitingTests: [task({ id: 'b1', needs: 'test', tags: ['be'] })], pr: releasePr() });
  await processRelease(waiting.deps, { ...shop, area: 'be' });
  assert.deepEqual(ghCalls(waiting.commands.calls), []);
  assert.deepEqual([readReleases(home)['/p/shop'].state, readReleases(home)['/p/shop'].reason], ['waiting-test', '1 task waits for a test by hand']);
  const other = world(tempDir('home'), { waitingTests: [task({ id: 'f1', needs: 'test', tags: ['fe'] })], pr: releasePr() });
  await processRelease({ ...other.deps, now: () => NOW - 5 * 60_000 }, { ...shop, area: 'be' });
  await processRelease(other.deps, { ...shop, area: 'be' });
  assert.ok(ghCalls(other.commands.calls).includes('pr merge'));
});

test('without a release pull request, one is opened from staging to production', async () => {
  const home = tempDir('home');
  const run = world(home, { pr: null });
  await processRelease(run.deps, shop);
  assert.deepEqual(ghCalls(run.commands.calls), ['pr list', 'pr create']);
  assert.equal(readReleases(home)['/p/shop'].state, 'waiting-ci');
  assert.ok(run.events.some((event) => event.event === 'release-opened'));
});

test('a green release pull request at the staging commit is merged with a merge commit', async () => {
  const home = tempDir('home');
  const run = world(home, { pr: releasePr() });
  // The head was first seen before: the settle time is over.
  await processRelease({ ...run.deps, now: () => NOW - 5 * 60_000 }, shop);
  await processRelease(run.deps, shop);
  const merge = run.commands.calls.find((call) => call.args[1] === 'merge');
  assert.deepEqual(merge?.args, ['pr', 'merge', '30', '--merge', '--match-head-commit', 'dev777']);
  assert.equal(readReleases(home)['/p/shop'].state, 'released');
  assert.equal(run.events.find((event) => event.event === 'release')?.pr, 30);
});

test('a head seen for the first time waits for the settle time, even with green checks', async () => {
  const home = tempDir('home');
  const run = world(home, { pr: releasePr() });
  await processRelease(run.deps, shop);
  assert.equal(ghCalls(run.commands.calls).includes('pr merge'), false);
  assert.equal(readReleases(home)['/p/shop'].state, 'waiting-ci');
});

test('staging that moved on since the pull request was read is not merged', async () => {
  const home = tempDir('home');
  const run = world(home, { pr: releasePr({ headRefOid: 'dev700' }), staging: 'dev777' });
  await processRelease({ ...run.deps, now: () => NOW - 5 * 60_000 }, shop);
  await processRelease(run.deps, shop);
  assert.equal(ghCalls(run.commands.calls).includes('pr merge'), false);
  assert.equal(readReleases(home)['/p/shop'].state, 'waiting-ci');
});

test('conflicts, a failed CI or a refused merge block the release, with one event for each new reason', async () => {
  const cases: [Scenario, string][] = [
    [{ pr: releasePr({ mergeable: 'CONFLICTING' }) }, 'the release pull request has conflicts'],
    [{ pr: releasePr({ statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }] }) }, 'the CI of the release failed'],
    [{ pr: releasePr(), mergeCode: 1 }, 'merge refused'],
  ];
  for (const [scenario, reason] of cases) {
    const home = tempDir('home');
    const run = world(home, scenario);
    await processRelease({ ...run.deps, now: () => NOW - 5 * 60_000 }, shop);
    await processRelease(run.deps, shop);
    await processRelease(run.deps, shop);
    const state = readReleases(home)['/p/shop'];
    assert.equal(state.state, 'blocked', reason);
    assert.ok(state.reason.includes(reason), reason);
    assert.equal(run.events.filter((event) => event.event === 'release-blocked').length, 1, reason);
  }
});

test('a release pull request closed by a person stops the release until staging moves on', async () => {
  const home = tempDir('home');
  await processRelease(world(home, { pr: releasePr({ mergeable: 'UNKNOWN' }) }).deps, shop);
  const closed = world(home, { pr: null, viewState: 'CLOSED' });
  await processRelease(closed.deps, shop);
  assert.equal(ghCalls(closed.commands.calls).includes('pr create'), false);
  assert.equal(readReleases(home)['/p/shop'].state, 'blocked');
  assert.ok(readReleases(home)['/p/shop'].reason.includes('closed'));
  const moved = world(home, { pr: null, viewState: 'CLOSED', staging: 'dev888' });
  await processRelease(moved.deps, shop);
  assert.ok(ghCalls(moved.commands.calls).includes('pr create'));
});

test('a release that went through logs the release, without a waiting event', async () => {
  const home = tempDir('home');
  const run = world(home, { pr: releasePr() });
  await processRelease({ ...run.deps, now: () => NOW - 5 * 60_000 }, shop);
  await processRelease(run.deps, shop);
  assert.equal(run.events.some((event) => event.event === 'release-waiting' && event.state === 'released'), false);
});
