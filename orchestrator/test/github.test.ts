import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aheadBy, checksState, currentBranch, defaultBranch, fetchRemote, findPullRequest, findReleasePullRequest, isInBranch, mergePullRequest, openReleasePullRequest, remoteCommit } from '../src/github.ts';
import { fakeCommands } from './helpers.ts';

const prJson = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  number: 12,
  url: 'https://github.com/acme/shop/pull/12',
  state: 'OPEN',
  baseRefName: 'dev',
  headRefName: 'feat/discount',
  headRefOid: 'abc123',
  mergedAt: null,
  mergeCommit: null,
  createdAt: '2026-09-27T09:00:00Z',
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
  assert.deepEqual(pr, { number: 12, url: 'https://github.com/acme/shop/pull/12', state: 'OPEN', baseRefName: 'dev', headRefName: 'feat/discount', headRefOid: 'abc123', mergedAt: null, mergeCommit: null, createdAt: '2026-09-27T09:00:00Z', mergeable: 'MERGEABLE', checks: 'pass' });
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

test('the merge commit of a merged pull request', async () => {
  const gh = fakeCommands({ 'gh pr': () => ({ stdout: prJson({ state: 'MERGED', mergeCommit: { oid: 'm42' } }) }) });
  assert.equal((await findPullRequest(gh.run, '/p/shop', '12'))?.mergeCommit, 'm42');
});

test('the default branch of the remote, or null when git cannot tell', async () => {
  const known = fakeCommands({ git: () => ({ stdout: 'origin/main\n' }) });
  assert.equal(await defaultBranch(known.run, '/p/shop'), 'main');
  assert.deepEqual(known.calls[0].args, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const unknown = fakeCommands({ git: () => ({ code: 128, stderr: 'not a symbolic ref' }) });
  assert.equal(await defaultBranch(unknown.run, '/p/shop'), null);
});

test('the git calls of a release: fetch, remote commit, how far ahead, whether a commit is in a branch', async () => {
  const git = fakeCommands({
    'git fetch': () => ({ code: 0 }),
    'git rev-parse': () => ({ stdout: 'dev777\n' }),
    'git rev-list': () => ({ stdout: '3\n' }),
    'git merge-base': (call) => ({ code: call.args[2] === 'in1' ? 0 : 1 }),
  });
  assert.equal(await fetchRemote(git.run, '/p/shop'), true);
  // Never a prompt for credentials: it would hang the loop.
  assert.equal(git.calls[0].env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(await remoteCommit(git.run, '/p/shop', 'dev'), 'dev777');
  assert.equal(await aheadBy(git.run, '/p/shop', 'main', 'dev'), 3);
  assert.equal(await isInBranch(git.run, '/p/shop', 'in1', 'main'), true);
  assert.equal(await isInBranch(git.run, '/p/shop', 'out1', 'main'), false);
  assert.deepEqual(git.calls.map((call) => call.args), [
    ['fetch', '--quiet'],
    ['rev-parse', '--verify', '--quiet', 'origin/dev'],
    ['rev-list', '--count', 'origin/main..origin/dev'],
    ['merge-base', '--is-ancestor', 'in1', 'origin/main'],
    ['merge-base', '--is-ancestor', 'out1', 'origin/main'],
  ]);
  const offline = fakeCommands({ git: () => ({ code: 128, stderr: 'Could not resolve host' }) });
  assert.equal(await fetchRemote(offline.run, '/p/shop'), false);
  assert.equal(await remoteCommit(offline.run, '/p/shop', 'dev'), null);
  assert.equal(await aheadBy(offline.run, '/p/shop', 'main', 'dev'), 0);
});

test('the release pull request: found among the open ones, opened when missing, merged with a merge commit', async () => {
  const found = fakeCommands({ 'gh pr': () => ({ stdout: `[${prJson({ baseRefName: 'main', headRefName: 'dev' })}]` }) });
  assert.equal((await findReleasePullRequest(found.run, '/p/shop', 'main', 'dev'))?.headRefName, 'dev');
  assert.deepEqual(found.calls[0].args.slice(0, 8), ['pr', 'list', '--base', 'main', '--head', 'dev', '--state', 'open']);
  const none = fakeCommands({ 'gh pr': () => ({ stdout: '[]' }) });
  assert.equal(await findReleasePullRequest(none.run, '/p/shop', 'main', 'dev'), null);
  const open = fakeCommands();
  await openReleasePullRequest(open.run, '/p/shop', 'main', 'dev');
  assert.deepEqual(open.calls[0].args, ['pr', 'create', '--base', 'main', '--head', 'dev', '--title', 'release: dev to main', '--body', 'Release of dev to main by the taskwire orchestrator.']);
  const merge = fakeCommands();
  await mergePullRequest(merge.run, '/p/shop', 30, 'dev777', 'merge');
  assert.deepEqual(merge.calls[0].args, ['pr', 'merge', '30', '--merge', '--match-head-commit', 'dev777']);
});
