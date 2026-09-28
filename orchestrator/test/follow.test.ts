import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { discoverProjects, followProject, projectSearchRoots, unfollowProject } from '../src/projects.ts';
import { loadConfig } from '../src/config.ts';
import { writeClaims } from '../src/state.ts';
import { OrchestratorError } from '../src/errors.ts';
import { fakeTaskwire, projectDir, tempDir } from './helpers.ts';

const conventions = { conventions: { language: 'English', instructions: null } };
const saved = (home: string) => JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as { projects: { path: string }[]; projectRoots?: string[] };

async function refusal(promise: Promise<unknown>): Promise<OrchestratorError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof OrchestratorError);
    return error;
  }
  throw new Error('expected a refusal');
}

test('follow saves a taskwire project, after checking taskwire works there', async () => {
  const home = tempDir('home');
  const project = projectDir();
  const taskwire = fakeTaskwire(conventions);
  const entry = await followProject({ home, runTaskwire: taskwire.run }, project, 'npm test');
  assert.deepEqual(entry, { path: project, testCommand: 'npm test' });
  assert.deepEqual(saved(home).projects, [{ path: project, testCommand: 'npm test' }]);
  assert.deepEqual(taskwire.calls, [{ args: ['conventions'], cwd: project }]);
});

test('follow accepts a path under the home folder written with ~', async () => {
  const home = tempDir('home');
  const taskwire = fakeTaskwire(conventions);
  // The folder does not exist under the real home, so the refusal names the expanded path.
  const error = await refusal(followProject({ home, runTaskwire: taskwire.run }, '~/no-such-project-for-tests'));
  assert.match(error.message, new RegExp(`^${join(homedir(), 'no-such-project-for-tests')} `));
});

test('follow refuses a relative path, a folder without .taskwire.json and a project already followed', async () => {
  const home = tempDir('home');
  const project = projectDir();
  const deps = { home, runTaskwire: fakeTaskwire(conventions).run };
  assert.equal((await refusal(followProject(deps, 'code/website'))).exitCode, 2);
  const plain = await refusal(followProject(deps, tempDir('plain')));
  assert.equal(plain.exitCode, 2);
  assert.match(plain.hint ?? '', /taskwire setup/);
  await followProject(deps, project);
  assert.match((await refusal(followProject(deps, project))).message, /already followed/);
});

test('follow refuses an empty test command', async () => {
  const deps = { home: tempDir('home'), runTaskwire: fakeTaskwire(conventions).run };
  assert.equal((await refusal(followProject(deps, projectDir(), '  '))).exitCode, 2);
});

test('follow reports a taskwire failure in the project as a configuration problem', async () => {
  const home = tempDir('home');
  const failing = async () => {
    throw new Error('No ClickUp token found');
  };
  const error = await refusal(followProject({ home, runTaskwire: failing }, projectDir()));
  assert.equal(error.exitCode, 3);
  assert.match(error.message, /No ClickUp token found/);
});

test('unfollow removes the project from the config and keeps the others', async () => {
  const home = tempDir('home');
  const website = projectDir('website');
  const shop = projectDir('shop');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ maxAgents: 3, projects: [{ path: website }, { path: shop, testCommand: 'npm test' }] }));
  unfollowProject(home, website);
  assert.deepEqual(saved(home), { maxAgents: 3, projects: [{ path: shop, testCommand: 'npm test' }] });
});

test('unfollow refuses a project that is not followed', async () => {
  const home = tempDir('home');
  assert.throws(() => unfollowProject(home, '/code/website'), (error: unknown) => error instanceof OrchestratorError && error.exitCode === 2);
});

test('unfollow refuses a project while an agent works in it', async () => {
  const home = tempDir('home');
  const website = projectDir('website');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: website }] }));
  writeClaims(home, { t1: { project: website, name: 'Task one', worktree: '/tmp/w', startedAt: '2026-09-28T10:00:00.000Z' } });
  assert.throws(() => unfollowProject(home, website), /agent is working/);
  assert.equal(saved(home).projects.length, 1);
});

// A tree like ~/code: projects at different depths, and folders the search must skip.
function codeTree(): string {
  const root = tempDir('code');
  const project = (path: string) => {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, '.taskwire.json'), '{}');
  };
  project('website');
  project('clients/acme/shop');
  project('website/packages/inner');
  project('.hidden/secret');
  project('tools/node_modules/lib');
  project('a/b/c/too-deep');
  mkdirSync(join(root, 'notes'));
  return root;
}

test('discover finds the taskwire projects under a root, up to three levels down', () => {
  const root = codeTree();
  const found = discoverProjects({ roots: [root], followed: [] });
  assert.deepEqual(found.projects, [
    { path: join(root, 'clients/acme/shop'), name: 'shop' },
    { path: join(root, 'website'), name: 'website' },
  ]);
  assert.deepEqual(found.roots, [root]);
  assert.equal(found.truncated, false);
});

test('discover leaves out the projects already followed', () => {
  const root = codeTree();
  const found = discoverProjects({ roots: [root], followed: [join(root, 'website')] });
  assert.deepEqual(found.projects.map((p) => p.name), ['shop']);
});

test('discover stops after a number of folders, and says so', () => {
  const root = codeTree();
  const found = discoverProjects({ roots: [root], followed: [], maxFolders: 3 });
  assert.equal(found.truncated, true);
});

test('discover skips a root that does not exist', () => {
  const found = discoverProjects({ roots: [join(tempDir('gone'), 'missing')], followed: [] });
  assert.deepEqual(found.projects, []);
});

test('without projectRoots, discover looks next to the projects already followed', () => {
  const website = projectDir('website');
  assert.deepEqual(projectSearchRoots({ projects: [{ path: website }, { path: join(dirname(website), 'shop') }] }), [dirname(website)]);
  assert.deepEqual(projectSearchRoots({ projects: [{ path: website }], projectRoots: ['/code'] }), ['/code']);
  assert.deepEqual(projectSearchRoots({ projects: [] }), []);
});

test('projectRoots in the config must be absolute paths', () => {
  const home = tempDir('home');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projectRoots: ['/code', '~/work'], projects: [] }));
  assert.deepEqual(loadConfig(home).projectRoots, ['/code', join(homedir(), 'work')]);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projectRoots: ['code'], projects: [] }));
  assert.throws(() => loadConfig(home), /projectRoots/);
});
