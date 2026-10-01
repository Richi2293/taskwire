import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksState, currentBranch, findPullRequest, mergePullRequest } from '../src/github.ts';
import { fakeCommands } from './helpers.ts';

const prJson = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  number: 12,
  url: 'https://github.com/acme/shop/pull/12',
  state: 'OPEN',
  baseRefName: 'dev',
  headRefName: 'feat/discount',
  headRefOid: 'abc123',
  mergedAt: null,
  mergeable: 'MERGEABLE',
  statusCheckRollup: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  ...overrides,
});

test('the branch of a worktree, or null on a detached HEAD', async () => {
  const onBranch = fakeCommands({ git: () => ({ stdout: 'feat/discount\n' }) });
  assert.equal(await currentBranch(onBranch.run, '/wt'), 'feat/discount');
  assert.deepEqual(onBranch.calls[0].args, ['branch', '--show-current']);
  const detached = fakeCommands({ git: () => ({ stdout: '' }) });
  assert.equal(await currentBranch(detached.run, '/wt'), null);
});

test('the pull request of a branch, with the state of its checks', async () => {
  const gh = fakeCommands({ 'gh pr': () => ({ stdout: prJson() }) });
  const pr = await findPullRequest(gh.run, '/p/shop', 'feat/discount');
  assert.deepEqual(pr, { number: 12, url: 'https://github.com/acme/shop/pull/12', state: 'OPEN', baseRefName: 'dev', headRefName: 'feat/discount', headRefOid: 'abc123', mergedAt: null, mergeable: 'MERGEABLE', checks: 'pass' });
  assert.deepEqual(gh.calls[0].args.slice(0, 3), ['pr', 'view', 'feat/discount']);
});

test('a branch without a pull request gives null; any other gh failure is an error', async () => {
  const none = fakeCommands({ 'gh pr': () => ({ code: 1, stderr: 'no pull requests found for branch "feat/discount"' }) });
  assert.equal(await findPullRequest(none.run, '/p/shop', 'feat/discount'), null);
  const missing = fakeCommands({ gh: () => ({ code: 127, stderr: 'spawn gh ENOENT' }) });
  await assert.rejects(findPullRequest(missing.run, '/p/shop', 'feat/discount'), /gh pr view failed: spawn gh ENOENT/);
  const garbled = fakeCommands({ 'gh pr': () => ({ stdout: 'not json' }) });
  await assert.rejects(findPullRequest(garbled.run, '/p/shop', 'feat/discount'), /gh pr view did not print JSON/);
});

test('checks pass only when every one succeeded, fail when one failed, and wait otherwise', () => {
  const run = (status: string, conclusion: string) => ({ __typename: 'CheckRun', status, conclusion });
  assert.equal(checksState([run('COMPLETED', 'SUCCESS'), run('COMPLETED', 'SKIPPED'), { __typename: 'StatusContext', state: 'SUCCESS' }]), 'pass');
  assert.equal(checksState([run('COMPLETED', 'SUCCESS'), run('IN_PROGRESS', '')]), 'pending');
  assert.equal(checksState([run('COMPLETED', 'FAILURE'), run('IN_PROGRESS', '')]), 'fail');
  assert.equal(checksState([{ __typename: 'StatusContext', state: 'ERROR' }]), 'fail');
  assert.equal(checksState([]), 'none');
  assert.equal(checksState(null), 'none');
});

test('merging squashes the pull request only at the verified commit, and a refusal is an error', async () => {
  const ok = fakeCommands();
  await mergePullRequest(ok.run, '/p/shop', 12, 'abc123');
  assert.deepEqual(ok.calls[0], { command: 'gh', args: ['pr', 'merge', '12', '--squash', '--match-head-commit', 'abc123'], cwd: '/p/shop', env: {} });
  const refused = fakeCommands({ 'gh pr': () => ({ code: 1, stderr: 'Pull request is not mergeable' }) });
  await assert.rejects(mergePullRequest(refused.run, '/p/shop', 12, 'abc123'), /gh pr merge failed: Pull request is not mergeable/);
});
