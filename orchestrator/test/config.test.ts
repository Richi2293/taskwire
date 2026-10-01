import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, mergeLevel } from '../src/config.ts';
import { tempDir } from './helpers.ts';

function configWith(project: Record<string, unknown>): string {
  const home = tempDir('home');
  writeFileSync(join(home, 'config.json'), JSON.stringify({ projects: [{ path: '/p/shop', ...project }] }));
  return home;
}

test('a project without a merge level is PR only', () => {
  const [project] = loadConfig(configWith({})).projects;
  assert.equal(mergeLevel(project), 'none');
  assert.equal(project.stagingBranch, undefined);
});

test('the merge level and the staging branch are read from the config', () => {
  const [project] = loadConfig(configWith({ merge: 'dev', stagingBranch: 'develop' })).projects;
  assert.equal(mergeLevel(project), 'dev');
  assert.equal(project.stagingBranch, 'develop');
});

test('an unknown merge level is a configuration error', () => {
  assert.throws(() => loadConfig(configWith({ merge: 'always' })), /"merge" of \/p\/shop must be "none", "dev" or "main"/);
  assert.throws(() => loadConfig(configWith({ stagingBranch: '' })), /"stagingBranch" of \/p\/shop must be a non empty string/);
});
