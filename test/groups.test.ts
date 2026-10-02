import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groupsFilePath, similarArea } from '../src/groups.ts';
import { FOLDER_ID, LIST_ID, WORKSPACE_ID, rawTask, runCli } from './helpers.ts';

// A machine with a taskwire home for the groups file, and project folders with their own .taskwire.json.
function machine() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'taskwire-groups-')));
  const home = join(root, 'home');
  const env = { TASKWIRE_HOME: home };
  const project = (name: string, config: Record<string, unknown> | null) => {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    if (config !== null) {
      writeFileSync(join(dir, '.taskwire.json'), JSON.stringify({ workspaceId: WORKSPACE_ID, folderId: FOLDER_ID, defaultListId: LIST_ID, ...config }));
    }
    return dir;
  };
  const writeGroups = (data: unknown) => {
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'groups.json'), JSON.stringify(data));
  };
  const readGroups = (): unknown => JSON.parse(readFileSync(join(home, 'groups.json'), 'utf8'));
  return { root, home, env, project, writeGroups, readGroups };
}

// A group "acme" with the backend (this project), the web app and an area without code.
function acme() {
  const m = machine();
  const api = m.project('api', { area: 'backend' });
  const web = m.project('web', { area: 'frontend' });
  m.writeGroups({
    groups: {
      acme: {
        areas: {
          backend: { description: 'API and database', path: api },
          frontend: { description: 'Web app', path: web },
          infra: { description: 'Servers, DNS, deploy' },
        },
      },
    },
  });
  return { ...m, api, web };
}

test('the groups file lives in TASKWIRE_HOME, else in the XDG config folder, else in ~/.config', () => {
  assert.equal(groupsFilePath({ TASKWIRE_HOME: '/t', XDG_CONFIG_HOME: '/x', HOME: '/h' }), '/t/groups.json');
  assert.equal(groupsFilePath({ XDG_CONFIG_HOME: '/x', HOME: '/h' }), '/x/taskwire/groups.json');
  assert.equal(groupsFilePath({ HOME: '/h' }), '/h/.config/taskwire/groups.json');
  assert.equal(groupsFilePath({}), null);
});

test('similarArea finds a name too close to an existing one', () => {
  const names = ['backend', 'marketing', 'infra', 'product-analysis'];
  assert.equal(similarArea(names, 'marketin'), 'marketing');
  assert.equal(similarArea(names, 'mktg'), 'marketing');
  assert.equal(similarArea(names, 'infrastructure'), 'infra');
  assert.equal(similarArea(names, 'analysis'), 'product-analysis');
  assert.equal(similarArea(names, 'backends'), 'backend');
  assert.equal(similarArea(names, 'feedback'), null);
  assert.equal(similarArea(names, 'mobile'), null);
  assert.equal(similarArea(names, 'frontend'), null);
});

test('group init registers the group with the area of this project, without calling the provider', async () => {
  const m = machine();
  const api = m.project('api', { area: 'backend' });
  const run = await runCli(['group', 'init', 'Acme', '--description', 'API and database'], { cwd: api, env: m.env });
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(m.readGroups(), { groups: { acme: { areas: { backend: { description: 'API and database', path: api } } } } });
  assert.deepEqual(run.json(), {
    name: 'acme',
    areas: [{ name: 'backend', description: 'API and database', path: api, own: true }],
  });
  assert.equal(run.calls.length, 0);
});

test('group init needs an area, a description, a new name and a project in no group', async () => {
  const noArea = machine();
  const dir = noArea.project('api', {});
  assert.equal((await runCli(['group', 'init', 'acme', '--description', 'x'], { cwd: dir, env: noArea.env })).code, 2);

  const a = acme();
  assert.equal((await runCli(['group', 'init', 'acme2'], { cwd: a.api, env: a.env })).code, 2);
  assert.equal((await runCli(['group', 'init', 'other', '--description', 'x'], { cwd: a.api, env: a.env })).code, 2);
  const mobile = a.project('app', { area: 'mobile' });
  assert.equal((await runCli(['group', 'init', 'acme', '--description', 'x'], { cwd: mobile, env: a.env })).code, 2);
});

test('group commands need a home for the groups file', async () => {
  const m = machine();
  const api = m.project('api', { area: 'backend' });
  const run = await runCli(['group', 'init', 'acme', '--description', 'x'], { cwd: api });
  assert.equal(run.code, 3);
});

test('group prints the group of this project with its areas, or null', async () => {
  const a = acme();
  const run = await runCli(['group'], { cwd: a.web, env: a.env });
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(run.json(), {
    name: 'acme',
    areas: [
      { name: 'backend', description: 'API and database', path: a.api, own: false },
      { name: 'frontend', description: 'Web app', path: a.web, own: true },
      { name: 'infra', description: 'Servers, DNS, deploy', path: null, own: false },
    ],
  });
  const alone = a.project('alone', { area: 'docs' });
  assert.equal((await runCli(['group'], { cwd: alone, env: a.env })).stdout, 'null\n');
  assert.equal((await runCli(['group'], { cwd: alone })).stdout, 'null\n');
});

test('a project whose area differs from its area in the group fails with a configuration error', async () => {
  const a = acme();
  writeFileSync(join(a.web, '.taskwire.json'), JSON.stringify({ folderId: FOLDER_ID, area: 'web' }));
  const run = await runCli(['group'], { cwd: a.web, env: a.env });
  assert.equal(run.code, 3);
  assert.match(run.stderr, /frontend/);
});

test('a groups file that is not valid fails with a configuration error', async () => {
  const m = machine();
  const api = m.project('api', { area: 'backend' });
  for (const data of ['{', '[]', '{"groups":{"acme":{"areas":{"be":{}}}}}', '{"groups":{"acme":{"areas":{"be":{"description":"x","path":3}}}}}']) {
    mkdirSync(m.home, { recursive: true });
    writeFileSync(join(m.home, 'groups.json'), data);
    assert.equal((await runCli(['group'], { cwd: api, env: m.env })).code, 3, data);
  }
});

test('project prints the name of the group, or null', async () => {
  const a = acme();
  assert.equal((await runCli(['project'], { cwd: a.api, env: a.env }).then((r) => r.json()) as { group: string }).group, 'acme');
  const alone = a.project('alone', { area: 'docs' });
  assert.equal((await runCli(['project'], { cwd: alone, env: a.env }).then((r) => r.json()) as { group: null }).group, null);
});

test('area add adds an area without code to the group', async () => {
  const a = acme();
  const run = await runCli(['area', 'add', 'Feedback', '--description', 'Customer feedback'], { cwd: a.api, env: a.env });
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(run.json(), { name: 'feedback', description: 'Customer feedback', path: null, own: false });
  const groups = a.readGroups() as { groups: { acme: { areas: Record<string, unknown> } } };
  assert.deepEqual(groups.groups.acme.areas.feedback, { description: 'Customer feedback' });
  assert.equal(run.calls.length, 0);
});

test('area add with --path adds the area of another repository, as an absolute path', async () => {
  const a = acme();
  const app = a.project('app', { area: 'mobile' });
  const run = await runCli(['area', 'add', 'mobile', '--description', 'iOS and Android app', '--path', '../app'], { cwd: a.api, env: a.env });
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(run.json(), { name: 'mobile', description: 'iOS and Android app', path: app, own: false });
});

test('area add updates the description and the path of an existing area', async () => {
  const a = acme();
  const run = await runCli(['area', 'add', 'infra', '--description', 'Servers and deploy'], { cwd: a.api, env: a.env });
  assert.equal(run.code, 0, run.stderr);
  const groups = a.readGroups() as { groups: { acme: { areas: Record<string, unknown> } } };
  assert.deepEqual(groups.groups.acme.areas.infra, { description: 'Servers and deploy' });
});

test('area add refuses a name too close to an existing area, unless --force', async () => {
  const a = acme();
  const refused = await runCli(['area', 'add', 'infrastructure', '--description', 'x'], { cwd: a.api, env: a.env });
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /infra/);
  assert.match(refused.stderr, /--force/);
  const forced = await runCli(['area', 'add', 'infrastructure', '--description', 'x', '--force'], { cwd: a.api, env: a.env });
  assert.equal(forced.code, 0, forced.stderr);
});

test('area add checks its input', async () => {
  const a = acme();
  const other = a.project('other', { area: 'docs' });
  const empty = a.project('empty', null);
  const cases = [
    ['area', 'add', 'feedback'],
    ['area', 'add', 'two words', '--description', 'x'],
    ['area', 'add', 'none', '--description', 'x'],
    ['area', 'add', 'mobile', '--description', 'x', '--path', join(a.root, 'missing')],
    // The path of another area.
    ['area', 'add', 'mobile', '--description', 'x', '--path', a.web],
    // A repository whose .taskwire.json has another area.
    ['area', 'add', 'mobile', '--description', 'x', '--path', other],
  ];
  for (const args of cases) {
    assert.equal((await runCli(args, { cwd: a.api, env: a.env })).code, 2, args.join(' '));
  }
  // The project of this repository: its path cannot move.
  assert.equal((await runCli(['area', 'add', 'backend', '--description', 'x', '--path', empty], { cwd: a.api, env: a.env })).code, 2);
  // Without a group.
  const alone = a.project('alone', { area: 'docs2' });
  assert.equal((await runCli(['area', 'add', 'feedback', '--description', 'x'], { cwd: alone, env: a.env })).code, 2);
});

test('area add warns when the repository of the path has no area yet', async () => {
  const a = acme();
  const app = a.project('app', {});
  const run = await runCli(['area', 'add', 'mobile', '--description', 'x', '--path', app], { cwd: a.api, env: a.env });
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stderr, /area set mobile/);
});

test('area remove takes an area out of the group, but not the area of this project', async () => {
  const a = acme();
  const run = await runCli(['area', 'remove', 'infra'], { cwd: a.api, env: a.env });
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(run.json(), { name: 'infra', removed: true });
  const groups = a.readGroups() as { groups: { acme: { areas: Record<string, unknown> } } };
  assert.deepEqual(Object.keys(groups.groups.acme.areas), ['backend', 'frontend']);
  assert.equal((await runCli(['area', 'remove', 'backend'], { cwd: a.api, env: a.env })).code, 2);
  assert.equal((await runCli(['area', 'remove', 'missing'], { cwd: a.api, env: a.env })).code, 2);
});

test('area set in a group renames the area in the group too', async () => {
  const a = acme();
  const run = await runCli(['area', 'set', 'api'], { cwd: a.api, env: a.env });
  assert.equal(run.code, 0, run.stderr);
  const groups = a.readGroups() as { groups: { acme: { areas: Record<string, unknown> } } };
  assert.deepEqual(Object.keys(groups.groups.acme.areas), ['api', 'frontend', 'infra']);
  assert.equal(JSON.parse(readFileSync(join(a.api, '.taskwire.json'), 'utf8')).area, 'api');
});

test('area set in a group refuses an area of another project and the removal', async () => {
  const a = acme();
  assert.equal((await runCli(['area', 'set', 'frontend'], { cwd: a.api, env: a.env })).code, 2);
  assert.equal((await runCli(['area', 'set', 'none'], { cwd: a.api, env: a.env })).code, 2);
  assert.equal(JSON.parse(readFileSync(join(a.api, '.taskwire.json'), 'utf8')).area, 'backend');
});

test('the groups file is created with its folder', async () => {
  const m = machine();
  const api = m.project('api', { area: 'backend' });
  assert.equal(existsSync(m.home), false);
  await runCli(['group', 'init', 'acme', '--description', 'x'], { cwd: api, env: m.env });
  assert.equal(existsSync(join(m.home, 'groups.json')), true);
});

const AREA_TASKS = [
  rawTask({ id: 'b1', tags: [{ name: 'backend' }] }),
  rawTask({ id: 'b2', tags: [{ name: 'backend' }, { name: 'frontend' }, { name: 'bug' }] }),
  rawTask({ id: 'f1', tags: [{ name: 'frontend' }] }),
  rawTask({ id: 'i1', tags: [{ name: 'infra' }] }),
  rawTask({ id: 'n1', tags: [{ name: 'bug' }] }),
  rawTask({ id: 'n2', tags: [] }),
];
const taskRoutes = { 'GET /team/1/task': { body: { tasks: AREA_TASKS, last_page: true } } };

test('areas lists the areas of the group with their tasks, and the tasks without area', async () => {
  const a = acme();
  const run = await runCli(['areas'], { cwd: a.api, env: a.env, routes: taskRoutes });
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(run.json(), {
    group: 'acme',
    areas: [
      { name: 'backend', description: 'API and database', path: a.api, own: true, tasks: 2 },
      { name: 'frontend', description: 'Web app', path: a.web, own: false, tasks: 2 },
      { name: 'infra', description: 'Servers, DNS, deploy', path: null, own: false, tasks: 1 },
    ],
    noArea: 2,
  });
  assert.equal(run.calls[0].url.searchParams.get('include_closed'), 'false');
  const closed = await runCli(['areas', '--include-closed'], { cwd: a.api, env: a.env, routes: taskRoutes });
  assert.equal(closed.calls[0].url.searchParams.get('include_closed'), 'true');
});

test('areas without a group lists only the area of the project', async () => {
  const m = machine();
  const api = m.project('api', { area: 'backend' });
  const run = await runCli(['areas'], { cwd: api, env: m.env, routes: taskRoutes });
  assert.deepEqual(run.json(), {
    group: null,
    areas: [{ name: 'backend', description: null, path: null, own: true, tasks: 2 }],
    noArea: null,
  });
});

const ids = (run: { json: () => unknown }) => (run.json() as { id: string }[]).map((t) => t.id);

test('tasks --no-area shows the tasks with no area of the group', async () => {
  const a = acme();
  const run = await runCli(['tasks', '--no-area'], { cwd: a.api, env: a.env, routes: taskRoutes });
  assert.equal(run.code, 0, run.stderr);
  assert.deepEqual(ids(run), ['n1', 'n2']);
});

test('tasks --no-area needs a group and goes alone with the other area options', async () => {
  const m = machine();
  const api = m.project('api', { area: 'backend' });
  const alone = await runCli(['tasks', '--no-area'], { cwd: api, env: m.env, routes: taskRoutes });
  assert.equal(alone.code, 3);
  assert.equal(alone.calls.length, 0);
  const a = acme();
  for (const args of [['--no-area', '--all-areas'], ['--no-area', '--area', 'infra']]) {
    const run = await runCli(['tasks', ...args], { cwd: a.api, env: a.env, routes: taskRoutes });
    assert.equal(run.code, 2, args.join(' '));
  }
});

test('tasks --area takes several areas and keeps the tasks with any of them', async () => {
  const a = acme();
  const run = await runCli(['tasks', '--area', 'frontend', '--area', 'Infra'], { cwd: a.api, env: a.env, routes: taskRoutes });
  assert.deepEqual(ids(run), ['b2', 'f1', 'i1']);
});

test('tasks --area in a group refuses an area the group does not have, without calling ClickUp', async () => {
  const a = acme();
  const run = await runCli(['tasks', '--area', 'mobile'], { cwd: a.api, env: a.env, routes: taskRoutes });
  assert.equal(run.code, 2);
  assert.match(run.stderr, /taskwire areas/);
  assert.equal(run.calls.length, 0);
});

test('tasks without area options keeps only the area of the project, also in a group', async () => {
  const a = acme();
  assert.deepEqual(ids(await runCli(['tasks'], { cwd: a.api, env: a.env, routes: taskRoutes })), ['b1', 'b2']);
});

const createRoutes = {
  [`GET /list/${LIST_ID}`]: { body: { id: LIST_ID, name: 'Backlog', folder: { id: FOLDER_ID, name: 'Project' }, statuses: [] } },
  [`POST /list/${LIST_ID}/task`]: { body: rawTask({ id: 'new' }) },
};
const sentTags = (run: { calls: { method: string; body: unknown }[] }) =>
  (run.calls.find((c) => c.method === 'POST')?.body as { tags?: string[] } | undefined)?.tags;

test('task create --area uses any area of the group, also several of them', async () => {
  const a = acme();
  const create = (args: string[]) => runCli(['task', 'create', '--name', 'New', ...args], { cwd: a.api, env: a.env, routes: createRoutes });
  assert.deepEqual(sentTags(await create(['--area', 'infra'])), ['infra']);
  assert.deepEqual(sentTags(await create(['--area', 'backend', '--area', 'frontend'])), ['backend', 'frontend']);
});

test('task create --area none creates a task without area, also without a group', async () => {
  const a = acme();
  const inGroup = await runCli(['task', 'create', '--name', 'New', '--area', 'none'], { cwd: a.api, env: a.env, routes: createRoutes });
  assert.equal(inGroup.code, 0, inGroup.stderr);
  assert.equal(sentTags(inGroup), undefined);
  const withTag = await runCli(['task', 'create', '--name', 'New', '--area', 'None', '--tag', 'bug'], { cwd: a.api, env: a.env, routes: createRoutes });
  assert.deepEqual(sentTags(withTag), ['bug']);
  const m = machine();
  const api = m.project('api', { area: 'backend' });
  const alone = await runCli(['task', 'create', '--name', 'New', '--area', 'none'], { cwd: api, env: m.env, routes: createRoutes });
  assert.equal(sentTags(alone), undefined);
});

test('task create refuses --area none with other areas, and an area the group does not have', async () => {
  const a = acme();
  for (const args of [['--area', 'none', '--area', 'infra'], ['--area', 'mobile']]) {
    const run = await runCli(['task', 'create', '--name', 'New', ...args], { cwd: a.api, env: a.env, routes: createRoutes });
    assert.equal(run.code, 2, args.join(' '));
    assert.equal(run.calls.length, 0);
  }
});

test('tags marks the tags that are areas', async () => {
  const a = acme();
  const run = await runCli(['tags'], { cwd: a.api, env: a.env, routes: taskRoutes });
  assert.deepEqual(run.json(), [
    { name: 'backend', tasks: 2, area: true },
    { name: 'bug', tasks: 2, area: false },
    { name: 'frontend', tasks: 2, area: true },
    { name: 'infra', tasks: 1, area: true },
  ]);
});

test('rules lists the areas of the group, with their paths', async () => {
  const a = acme();
  const run = await runCli(['rules'], { cwd: a.api, env: a.env });
  assert.equal(run.code, 0, run.stderr);
  const out = run.json() as { rules: string; area: string; group: string | null };
  assert.equal(out.group, 'acme');
  assert.match(out.rules, /The group `acme` has these areas/);
  assert.ok(out.rules.includes(`| \`frontend\` | Web app | \`${a.web}\` |`));
  assert.ok(out.rules.includes('| `infra` | Servers, DNS, deploy | no code |'));
  assert.ok(out.rules.includes(`| \`backend\` (this project) | API and database | \`${a.api}\` |`));
  assert.doesNotMatch(out.rules, /\{\w+\}/);
});

test('rules without a group explains how to record one', async () => {
  const m = machine();
  const api = m.project('api', { area: 'backend' });
  const out = (await runCli(['rules'], { cwd: api, env: m.env })).json() as { rules: string; group: string | null };
  assert.equal(out.group, null);
  assert.match(out.rules, /taskwire group init/);
  assert.doesNotMatch(out.rules, /\{\w+\}/);
});

test('a broken groups file does not block the commands that only show the group', async () => {
  const m = machine();
  const api = m.project('api', { area: 'backend' });
  mkdirSync(m.home, { recursive: true });
  writeFileSync(join(m.home, 'groups.json'), '{');
  const rules = await runCli(['rules'], { cwd: api, env: m.env });
  assert.equal(rules.code, 0, rules.stderr);
  assert.equal((rules.json() as { group: null }).group, null);
  assert.match(rules.stderr, /warning/);
  const project = await runCli(['project'], { cwd: api, env: m.env });
  assert.equal(project.code, 0, project.stderr);
  const tags = await runCli(['tags'], { cwd: api, env: m.env, routes: taskRoutes });
  assert.equal(tags.code, 0, tags.stderr);
  const set = await runCli(['area', 'set', 'api'], { cwd: api, env: m.env });
  assert.equal(set.code, 0, set.stderr);
  // The commands that need the group still fail.
  assert.equal((await runCli(['group'], { cwd: api, env: m.env })).code, 3);
});

test('a mismatched area does not block rules, project and tags, which warn instead', async () => {
  const a = acme();
  writeFileSync(join(a.web, '.taskwire.json'), JSON.stringify({ workspaceId: WORKSPACE_ID, folderId: FOLDER_ID, area: 'web' }));
  const rules = await runCli(['rules'], { cwd: a.web, env: a.env });
  assert.equal(rules.code, 0, rules.stderr);
  assert.match(rules.stderr, /area set frontend/);
  assert.equal((await runCli(['project'], { cwd: a.web, env: a.env })).code, 0);
});

test('names of object properties are not areas or groups', async () => {
  const a = acme();
  const create = await runCli(['task', 'create', '--name', 'New', '--area', 'constructor'], { cwd: a.api, env: a.env, routes: createRoutes });
  assert.equal(create.code, 2);
  assert.equal((await runCli(['area', 'remove', 'tostring'], { cwd: a.api, env: a.env })).code, 2);
  const added = await runCli(['area', 'add', 'constructor', '--description', 'x'], { cwd: a.api, env: a.env });
  assert.equal(added.code, 0, added.stderr);
  assert.deepEqual((a.readGroups() as { groups: { acme: { areas: Record<string, unknown> } } }).groups.acme.areas.constructor, { description: 'x' });
});

test('similarArea lets short names one letter apart through', () => {
  assert.equal(similarArea(['api'], 'app'), null);
  assert.equal(similarArea(['be'], 'fe'), null);
  assert.equal(similarArea(['infra'], 'intra'), 'infra');
});
