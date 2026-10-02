import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FOLDER_ID, LIST_ID, runCli } from './helpers.ts';

// A project folder with the given .taskwire.json, to read the file back after the command.
function projectDir(config: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'taskwire-project-'));
  writeFileSync(join(dir, '.taskwire.json'), JSON.stringify(config));
  return dir;
}

const readConfigFile = (dir: string): unknown => JSON.parse(readFileSync(join(dir, '.taskwire.json'), 'utf8'));

test('project prints the project configuration without calling the provider', async () => {
  const cwd = projectDir({ folderId: FOLDER_ID, listIds: [LIST_ID], defaultListId: LIST_ID, account: 'acme', area: 'mobile' });
  const run = await runCli(['project'], { cwd, keychains: { 'taskwire:acme': 'pk_secret' } });
  assert.equal(run.code, 0);
  assert.deepEqual(run.json(), {
    provider: 'clickup',
    account: 'acme',
    workspaceId: null,
    folderId: FOLDER_ID,
    listIds: [LIST_ID],
    defaultListId: LIST_ID,
    area: 'mobile',
    group: null,
  });
  assert.equal(run.calls.length, 0);
  assert.doesNotMatch(run.stdout, /pk_secret/);
});

test('project prints null for what the config leaves out', async () => {
  const run = await runCli(['project'], { cwd: projectDir({ folderId: FOLDER_ID }) });
  assert.deepEqual(run.json(), {
    provider: 'clickup', account: null, workspaceId: null, folderId: FOLDER_ID, listIds: null, defaultListId: null, area: null, group: null,
  });
});

test('area set writes the area and keeps the rest of the config', async () => {
  const config = { provider: 'clickup', folderId: FOLDER_ID, listIds: [LIST_ID], account: 'acme', conventions: { language: 'Italian' } };
  const cwd = projectDir(config);
  const run = await runCli(['area', 'set', 'Mobile'], { cwd, keychains: { 'taskwire:acme': 'pk_secret' } });
  assert.equal(run.code, 0);
  assert.deepEqual(readConfigFile(cwd), { ...config, area: 'mobile' });
  assert.deepEqual(run.json(), { path: join(cwd, '.taskwire.json'), area: 'mobile' });
  assert.equal(run.calls.length, 0);
});

test('area set none removes the area', async () => {
  const cwd = projectDir({ provider: 'clickup', folderId: FOLDER_ID, area: 'be' });
  const run = await runCli(['area', 'set', 'none'], { cwd });
  assert.equal(run.code, 0);
  assert.deepEqual(readConfigFile(cwd), { provider: 'clickup', folderId: FOLDER_ID });
  assert.equal((run.json() as { area: null }).area, null);
});

test('area set rejects a value that is not one word and leaves the config as it is', async () => {
  const cwd = projectDir({ provider: 'clickup', folderId: FOLDER_ID, area: 'be' });
  const run = await runCli(['area', 'set', 'two words'], { cwd });
  assert.equal(run.code, 2);
  assert.equal((readConfigFile(cwd) as { area: string }).area, 'be');
});

test('area set and project need a .taskwire.json', async () => {
  assert.equal((await runCli(['area', 'set', 'be'], { config: null })).code, 3);
  assert.equal((await runCli(['project'], { config: null })).code, 3);
});
