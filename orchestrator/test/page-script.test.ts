import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../src/dashboard/page.ts';
import type { DashboardState, ProjectSummary, WaitingItem } from '../src/dashboard/snapshot.ts';

// A tiny stand-in for the browser DOM: enough for the page script to render, and for a test to read what it rendered.
class FakeNode {
  children: unknown[] = [];
  attrs: Record<string, string> = {};
  textContent = '';
  className = '';
  hidden = false;
  disabled = false;
  value = '';
  open = false;
  onclick: ((event: { stopPropagation: () => void }) => void) | null = null;
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  append(...children: unknown[]): void { this.children.push(...children); }
  replaceChildren(...children: unknown[]): void { this.children = children; }
  setAttribute(key: string, value: string): void { this.attrs[key] = value; }
  querySelectorAll(): unknown[] { return []; }
  querySelector(): null { return null; }
  scrollIntoView(): void {}
  showModal(): void { this.open = true; }
  close(): void { this.open = false; }
  click(): void { this.onclick?.({ stopPropagation: () => {} }); }
  focus(): void {}
  addEventListener(): void {}
}

function text(node: unknown): string {
  if (typeof node === 'string') return node;
  if (!(node instanceof FakeNode)) return '';
  return node.textContent + node.children.map(text).join(' ');
}

function nodes(node: unknown, match: (node: FakeNode) => boolean): FakeNode[] {
  if (!(node instanceof FakeNode)) return [];
  return [...(match(node) ? [node] : []), ...node.children.flatMap((child) => nodes(child, match))];
}

// Runs the page script on a state, as the browser does at the first paint, and returns the rendered parts by id.
function renderScript(state: DashboardState): (id: string) => FakeNode {
  const html = renderPage(state, 'token');
  const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
  const script = scripts.find((match) => match[2].includes('const TOKEN'))?.[2] ?? '';
  const initial = scripts.find((match) => match[1].includes('initial-state'))?.[2] ?? '';
  const byId = new Map<string, FakeNode>();
  const get = (id: string): FakeNode => {
    if (!byId.has(id)) byId.set(id, new FakeNode('div'));
    return byId.get(id) as FakeNode;
  };
  const document = {
    createElement: (tag: string) => new FakeNode(tag),
    createElementNS: (_namespace: string, tag: string) => new FakeNode(tag),
    getElementById: (id: string) => (id === 'initial-state' ? { textContent: initial } : get(id)),
    querySelector: (selector: string) => (selector.startsWith('meta') ? { content: 'token' } : null),
    querySelectorAll: () => [],
    addEventListener: () => {},
  };
  const window = { matchMedia: () => ({ matches: false }), addEventListener: () => {} };
  const localStorage = { getItem: () => null, setItem: () => {} };
  const noop = () => {};
  new Function('document', 'window', 'localStorage', 'setTimeout', 'fetch', script)(document, window, localStorage, noop, noop);
  return get;
}

const NOW = '2026-10-01T10:00:00.000Z';

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    project: '/p/shop', projectName: 'shop', waiting: { decision: 0, test: 0, review: 0 }, working: null, doneToday: 0, error: null, readAt: NOW, reading: false,
    agents: true, analysis: null, analysisDue: false, area: null, group: null, merge: 'none', stagingBranch: 'dev', productionBranch: null, release: null,
    ...overrides,
  };
}

function waiting(overrides: Partial<WaitingItem> = {}): WaitingItem {
  return {
    project: '/p/shop', projectName: 'shop', id: 't1', name: 'Show the total', url: 'u', needs: 'test', status: 'qa', goal: null, since: null,
    note: [], questions: [], proposal: null, checked: [], byHand: [], proposedTask: null, readyToClose: null, autoMerge: false,
    ...overrides,
  };
}

function state(overrides: Partial<DashboardState> = {}): DashboardState {
  return {
    generatedAt: NOW,
    sync: { readAt: NOW, reading: false },
    control: { mode: 'paused', intervalMinutes: 5, maxAgents: 2, agentsAtWork: 0, nextCheckAt: null, busyProjects: [], firstTask: null },
    projects: [project()],
    waiting: [],
    working: [],
    history: [],
    live: [],
    problems: [],
    ...overrides,
  };
}

const live = { project: '/p/shop', projectName: 'shop', id: 't1', name: 'Show the total', url: 'u', pr: 12, at: NOW };

test('a live task selected in the queue shows its detail with Close the task', () => {
  const get = renderScript(state({ live: [live] }));
  assert.match(text(get('detail')), /Close the task/);
  assert.match(text(get('detail')), /Pull request #12 is in production/);
});

test('the same task waiting and live shows as two items, one of them selected', () => {
  const get = renderScript(state({ waiting: [waiting()], live: [live] }));
  // A waiting item is a button; a live item is a row with its own Close button.
  const items = nodes(get('queue'), (node) => node.className.startsWith('item '));
  assert.equal(items.length, 2);
  assert.equal(items.filter((node) => node.attrs['aria-pressed'] === 'true').length, 1);
});

test('the approve text promises a merge only when the orchestrator will make it', () => {
  const merging = { projects: [project({ merge: 'dev' })] };
  assert.match(text(renderScript(state({ ...merging, waiting: [waiting({ autoMerge: true })] }))('detail')), /lets the orchestrator merge the branch/);
  assert.match(text(renderScript(state({ ...merging, waiting: [waiting({ autoMerge: false })] }))('detail')), /merging the branch stays with you/);
});

test('a project with only live tasks gets its queue filter, counted', () => {
  const get = renderScript(state({ projects: [project(), project({ project: '/p/blog', projectName: 'blog' })], live: [live] }));
  assert.match(text(get('project-filters')), /shop\s+1/);
});

test('a release line ends with one period, and only for a project with level main', () => {
  const blocked = { state: 'blocked' as const, reason: 'the merge failed: gh pr merge failed: Not mergeable.', pr: 30 };
  assert.match(text(renderScript(state({ projects: [project({ merge: 'main', release: blocked })] }))('projects')), /Not mergeable\.(?!\.)/);
  assert.doesNotMatch(text(renderScript(state({ projects: [project({ merge: 'dev', release: blocked })] }))('projects')), /Release to/);
});

const pill = (get: (id: string) => FakeNode) => nodes(get('projects'), (node) => node.tag === 'button' && node.className.startsWith('merge-pill'))[0];

test('the merge level pill has its own column and an icon, and opens a modal to change it', () => {
  const get = renderScript(state({ projects: [project({ merge: 'dev' })] }));
  const row = nodes(get('projects'), (node) => node.className.startsWith('row'))[0];
  assert.ok(row.children.indexOf(pill(get)) === 1, 'the pill is the column after the name');
  assert.equal(nodes(pill(get), (node) => node.tag === 'svg').length, 1);
  pill(get).click();
  const dialog = get('merge-dialog');
  assert.equal(dialog.open, true);
  assert.match(text(dialog), /Who merges the work of shop/);
  const options = nodes(dialog, (node) => node.attrs.role === 'radio');
  assert.deepEqual(options.map((node) => node.attrs['aria-checked']), ['false', 'true', 'false']);
  // The project name is asked only once Auto to main is chosen.
  assert.doesNotMatch(text(dialog), /Type the project name/);
  options[2].click();
  assert.match(text(get('merge-dialog')), /Type the project name to confirm/);
  nodes(get('merge-dialog'), (node) => node.tag === 'button' && text(node).trim() === 'Cancel')[0].click();
  assert.equal(get('merge-dialog').open, false);
});

test('a live task has Close the task in its queue row', () => {
  const get = renderScript(state({ live: [live] }));
  const row = nodes(get('queue'), (node) => node.className.startsWith('item live'))[0];
  assert.ok(nodes(row, (node) => node.tag === 'button' && /Close the task/.test(text(node))).length === 1);
});

test('the items of a More menu stack one under the other', () => {
  const css = renderPage(state({}), 'token');
  assert.match(css, /details\.menu div \{[^}]*display: flex; flex-direction: column;/);
});

test('Remove project looks dangerous and asks in the confirm modal, not the browser', () => {
  const get = renderScript(state());
  const remove = nodes(get('projects'), (node) => node.tag === 'button' && text(node).trim() === 'Remove project')[0];
  assert.equal(remove.className, 'danger');
  remove.click();
  const dialog = get('confirm-dialog');
  assert.equal(dialog.open, true);
  assert.match(text(dialog), /Remove shop from the orchestrator\?/);
  const confirm = nodes(dialog, (node) => node.tag === 'button' && text(node).trim() === 'Remove project')[0];
  assert.equal(confirm.className, 'btn danger');
  nodes(dialog, (node) => node.tag === 'button' && text(node).trim() === 'Cancel')[0].click();
  assert.equal(dialog.open, false);
});

// The area comes from the project's .taskwire.json: the dashboard shows it and changes only the group.
test('Set group opens a form with the group only, and the area shown with the taskwire command that changes it', () => {
  const get = renderScript(state({ projects: [project({ area: 'fe', group: 'Acme' })] }));
  assert.match(text(get('projects')), /Area fe, Acme/);
  const menu = nodes(get('projects'), (node) => node.tag === 'button' && /Set /.test(text(node)));
  assert.deepEqual(menu.map((node) => text(node).trim()), ['Set group']);
  menu[0].click();
  const form = nodes(get('projects'), (node) => node.className === 'place-form')[0];
  const inputs = nodes(form, (node) => node.tag === 'input');
  assert.deepEqual(inputs.map((node) => node.attrs['aria-label']), ['Group']);
  assert.match(text(form), /fe/);
  assert.match(text(form), /taskwire area set <tag>/);
});
