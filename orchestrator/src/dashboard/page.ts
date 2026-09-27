import type { DashboardState } from './snapshot.ts';

// The whole page: markup, style and script inline, so the dashboard needs no files and no dependencies.
// Text from the task system is only ever set with textContent, never parsed as HTML.
export function renderPage(state: DashboardState, token: string): string {
  // "<" is escaped so a task name cannot close the script element.
  const initial = JSON.stringify(state).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="action-token" content="${token}">
<title>taskwire orchestrator</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <header>
    <h1>taskwire orchestrator</h1>
    <div class="control">
      <p id="status" class="status"></p>
      <button id="switch" type="button"></button>
    </div>
  </header>
  <section aria-labelledby="waiting-title">
    <h2 id="waiting-title">Waiting for you <span id="waiting-count" class="count"></span></h2>
    <ol id="waiting" class="waiting"></ol>
  </section>
  <section id="problems-section" aria-labelledby="problems-title" hidden>
    <h2 id="problems-title">Projects that could not be read</h2>
    <ul id="problems" class="problems"></ul>
  </section>
  <section aria-labelledby="working-title">
    <h2 id="working-title">At work now</h2>
    <ul id="working" class="working"></ul>
  </section>
  <section aria-labelledby="history-title">
    <h2 id="history-title">History</h2>
    <div id="history"></div>
  </section>
</main>
<script id="initial-state" type="application/json">${initial}</script>
<script>${SCRIPT}</script>
</body>
</html>
`;
}

const STYLE = `
:root {
  color-scheme: light dark;
  --bg: #f5f7f9; --panel: #ffffff; --ink: #0d1117; --muted: #56606d; --line: #d8dde4;
  --decision: #a35f00; --test: #0a6aa1; --review: #067a4b; --alive: #067a4b; --problem: #b42318; --code: #eaeef2;
  --mono: ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #07090d; --panel: #0e131a; --ink: #e8edf2; --muted: #93a0ae; --line: #1f2833;
    --decision: #ffc46b; --test: #6ad8ff; --review: #3dffa8; --alive: #3dffa8; --problem: #ff8a7a; --code: #1a222c;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px; }
header { margin-bottom: 36px; }
h1 { font-size: 1.1rem; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 6px; }
.control { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: center; justify-content: space-between; }
.status { margin: 0; color: var(--muted); }
.status .alive { color: var(--alive); font-weight: 600; }
h2 { font-size: 1.6rem; line-height: 1.2; font-weight: 650; letter-spacing: -0.02em; margin: 40px 0 16px; }
h3 { font-size: 0.95rem; font-weight: 600; color: var(--muted); margin: 24px 0 8px; }
.count { color: var(--muted); font-weight: 400; }
a { color: inherit; text-decoration-color: var(--line); text-underline-offset: 3px; }
a:hover { text-decoration-color: currentColor; }
a:focus-visible, button:focus-visible { outline: 2px solid var(--test); outline-offset: 2px; border-radius: 2px; }
ol, ul { list-style: none; margin: 0; padding: 0; }
.empty { color: var(--muted); margin: 0; }

.waiting > li { background: var(--panel); border: 1px solid var(--line); border-left: 4px solid var(--kind); border-radius: 6px; padding: 14px 16px; margin-bottom: 12px; }
.waiting > li[data-needs="decision"] { --kind: var(--decision); }
.waiting > li[data-needs="test"] { --kind: var(--test); }
.waiting > li[data-needs="review"] { --kind: var(--review); }
.kind { color: var(--kind); font-weight: 600; font-size: 0.9rem; margin: 0 0 2px; }
.kind .project { color: var(--muted); font-weight: 400; }
.task { font-size: 1.05rem; font-weight: 600; margin: 0 0 6px; }
.note { margin: 0; padding: 0; color: var(--ink); }
.note li { margin: 2px 0; overflow-wrap: anywhere; }
code { font-family: var(--mono); font-size: 0.88em; background: var(--code); border-radius: 3px; padding: 0 3px; }

.actions { margin-top: 12px; }
.buttons { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
button { font: inherit; font-size: 0.92rem; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel); color: var(--ink); cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--muted); }
button.primary { background: var(--ink); color: var(--panel); border-color: var(--ink); }
button.quiet { border-color: transparent; background: transparent; color: var(--muted); padding-left: 6px; padding-right: 6px; }
button:disabled { opacity: 0.55; cursor: default; }
.action-form { margin-top: 12px; }
.action-form label { display: block; margin-bottom: 8px; }
.action-form label span { display: block; font-size: 0.9rem; color: var(--muted); margin-bottom: 4px; }
textarea { width: 100%; font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; resize: vertical; }
textarea:focus-visible { outline: 2px solid var(--test); outline-offset: 1px; }
.result { margin: 8px 0 0; color: var(--muted); min-height: 0; }
.result:empty { display: none; }
.result.failed { color: var(--problem); }

.working li, .problems li { padding: 8px 0; border-bottom: 1px solid var(--line); }
.working .since, .problems .error { color: var(--muted); }
.problems .error { color: var(--problem); }

.timeline { border-left: 2px solid var(--line); margin-left: 3.2rem; }
.timeline li { position: relative; padding: 0 0 16px 18px; }
.timeline li::before { content: ""; position: absolute; left: -6px; top: 8px; width: 10px; height: 10px; border-radius: 50%; background: var(--bg); border: 2px solid var(--muted); }
.timeline li[data-needs="review"]::before { border-color: var(--review); }
.timeline li[data-needs="test"]::before { border-color: var(--test); }
.timeline li[data-needs="decision"]::before { border-color: var(--decision); }
.timeline time { position: absolute; left: -3.6rem; top: 1px; width: 3rem; text-align: right; font-family: var(--mono); font-size: 0.85rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.timeline .outcome { margin: 2px 0 0; color: var(--muted); }
.timeline .cost { font-family: var(--mono); font-size: 0.85rem; }

@media (max-width: 520px) {
  main { padding-top: 24px; }
  h2 { font-size: 1.35rem; }
  .timeline { margin-left: 0; border-left: 0; }
  .timeline li { padding-left: 0; }
  .timeline li::before { display: none; }
  .timeline time { position: static; display: block; width: auto; text-align: left; }
}
`;

// Runs in the browser. Builds every element with createElement and textContent only.
const SCRIPT = `
const KIND = { decision: 'Decision', test: 'Test by hand', review: 'Review' };
const REFRESH_MS = 30000;

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === 'text') node.textContent = value;
    else if (key.startsWith('data-')) node.setAttribute(key, value);
    else node[key] = value;
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

// Text with \`code\` spans, as agents write in comments, turned into text and code nodes.
function inline(text) {
  return text.split(/\`([^\`]+)\`/).map((part, index) => (index % 2 ? el('code', { text: part }) : part));
}

function time(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso) {
  const day = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) return 'Today';
  if (day.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

function minutesSince(iso, now) {
  const minutes = Math.max(0, Math.round((now - new Date(iso)) / 60000));
  return minutes < 60 ? minutes + ' min' : Math.floor(minutes / 60) + ' h ' + (minutes % 60) + ' min';
}

function outcome(run) {
  const parts = [];
  if (run.needs === 'decision') parts.push('Waiting for your decision.');
  else if (run.needs === 'test') parts.push('Waiting for your check by hand.');
  else if (run.needs === 'review' && run.verdict === 'pass') parts.push('Ready for your review, every criterion verified.');
  else if (run.needs === 'review') parts.push('Waiting for your review.');
  if (run.tests === 'pass') parts.push('Tests passed.');
  if (run.tests === 'fail') parts.push('Tests failed.');
  return parts.join(' ');
}

const TOKEN = document.querySelector('meta[name="action-token"]').content;
const DONE = { answer: 'Answer sent.', approve: 'Approved.', 'send-back': 'Sent back to the agent.', block: 'Agents will keep away from it.' };

async function send(item, action, text, box) {
  for (const button of box.querySelectorAll('button, textarea')) button.disabled = true;
  const result = box.querySelector('.result');
  result.className = 'result';
  result.textContent = 'Sending.';
  try {
    const response = await fetch('/api/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-action-token': TOKEN },
      body: JSON.stringify({ project: item.project, task: item.id, action, text }),
    });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(answer.error || 'The orchestrator answered ' + response.status + '.');
    result.textContent = DONE[action];
    for (const form of box.querySelectorAll('form')) form.hidden = true;
    setTimeout(refresh, 1200);
  } catch (error) {
    result.className = 'result failed';
    result.textContent = error.message;
    for (const button of box.querySelectorAll('button, textarea')) button.disabled = false;
  }
}

// A form that asks the person for a text before sending the action.
function textForm(item, action, label, submit, box) {
  const area = el('textarea', { rows: 3, required: true });
  const form = el('form', { className: 'action-form', hidden: true },
    el('label', {}, el('span', { text: label }), area),
    el('div', { className: 'buttons' },
      el('button', { type: 'submit', className: 'primary', text: submit }),
      el('button', { type: 'button', className: 'quiet', text: 'Cancel', onclick: () => { form.hidden = true; } })));
  form.onsubmit = (event) => {
    event.preventDefault();
    if (area.value.trim()) send(item, action, area.value, box);
  };
  return { form, open: () => { form.hidden = false; area.focus(); } };
}

function actionsFor(item) {
  const box = el('div', { className: 'actions' });
  const buttons = el('div', { className: 'buttons' });
  const forms = [];
  if (item.needs === 'decision') {
    const answer = textForm(item, 'answer', 'Your answer for the agent', 'Send answer', box);
    forms.push(answer.form);
    buttons.append(el('button', { type: 'button', className: 'primary', text: 'Answer', onclick: answer.open }));
  } else {
    const back = textForm(item, 'send-back', 'What the agent should fix', 'Send back to the agent', box);
    forms.push(back.form);
    buttons.append(
      el('button', { type: 'button', className: 'primary', text: 'Approve', onclick: () => send(item, 'approve', undefined, box) }),
      el('button', { type: 'button', text: 'Send back', onclick: back.open }));
  }
  buttons.append(el('button', { type: 'button', className: 'quiet', text: 'Keep agents away', onclick: () => send(item, 'block', undefined, box) }));
  box.append(buttons, ...forms, el('p', { className: 'result', role: 'status' }));
  return box;
}

async function switchMode(action, button) {
  button.disabled = true;
  try {
    const response = await fetch('/api/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-action-token': TOKEN },
      body: JSON.stringify({ action }),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'The orchestrator answered ' + response.status + '.');
  } catch (error) {
    document.getElementById('status').textContent = error.message;
  }
  button.disabled = false;
  refresh(true);
}

// Someone is typing or waiting for an answer: a refresh would throw that away.
function busy() {
  return [...document.querySelectorAll('.action-form')].some((form) => !form.hidden) || Boolean(document.querySelector('.actions button:disabled'));
}

function render(state) {
  const now = new Date(state.generatedAt);
  const status = document.getElementById('status');
  const finishing = state.mode === 'paused' && state.working.length ? ' Agents at work finish their task.' : '';
  status.replaceChildren(
    state.mode === 'working'
      ? el('span', { className: 'alive', text: 'Working: agents take the next tasks.' })
      : 'Paused: no agent takes a new task until you start.' + finishing,
    ' Updated ' + time(state.generatedAt) + '.',
  );
  const button = document.getElementById('switch');
  button.textContent = state.mode === 'working' ? 'Pause' : 'Start working';
  button.className = state.mode === 'working' ? '' : 'primary';
  button.disabled = false;
  button.onclick = () => switchMode(state.mode === 'working' ? 'pause' : 'play', button);

  const waiting = document.getElementById('waiting');
  document.getElementById('waiting-count').textContent = state.waiting.length ? String(state.waiting.length) : '';
  waiting.replaceChildren(...state.waiting.map((item) =>
    el('li', { 'data-needs': item.needs },
      el('p', { className: 'kind' }, KIND[item.needs] || item.needs, el('span', { className: 'project', text: ' in ' + item.projectName })),
      el('p', { className: 'task' }, el('a', { href: item.url, target: '_blank', rel: 'noopener', text: item.name })),
      item.note.length ? el('ul', { className: 'note' }, ...item.note.map((line) => el('li', {}, ...inline(line)))) : null,
      actionsFor(item),
    )));
  if (!state.waiting.length) waiting.replaceChildren(el('li', { className: 'empty', text: 'Nothing waits for you.' }));

  const problems = document.getElementById('problems');
  document.getElementById('problems-section').hidden = !state.problems.length;
  problems.replaceChildren(...state.problems.map((problem) =>
    el('li', {}, el('strong', { text: problem.projectName }), el('span', { className: 'error', text: ': ' + problem.error }))));

  const working = document.getElementById('working');
  working.replaceChildren(...state.working.map((item) =>
    el('li', {}, el('strong', { text: item.name }), el('span', { className: 'since', text: ' in ' + item.projectName + ', for ' + minutesSince(item.startedAt, now) })),
  ));
  if (!state.working.length) working.replaceChildren(el('li', { className: 'empty', text: 'No agent is working right now.' }));

  const history = document.getElementById('history');
  const days = new Map();
  for (const run of state.history) {
    const label = dayLabel(run.finishedAt);
    if (!days.has(label)) days.set(label, []);
    days.get(label).push(run);
  }
  history.replaceChildren(...[...days].flatMap(([label, runs]) => [
    el('h3', { text: label }),
    el('ol', { className: 'timeline' }, ...runs.map((run) =>
      el('li', { 'data-needs': run.needs || '' },
        el('time', { dateTime: run.finishedAt, text: time(run.finishedAt) }),
        el('a', { href: run.url, target: '_blank', rel: 'noopener', text: run.name }),
        el('p', { className: 'outcome' },
          run.projectName + '. ' + outcome(run),
          run.costUsd === null ? null : el('span', { className: 'cost', text: ' ' + run.costUsd.toFixed(2) + ' USD' })),
      ))),
  ]));
  if (!state.history.length) history.replaceChildren(el('p', { className: 'empty', text: 'No agent has worked on a task yet.' }));
}

render(JSON.parse(document.getElementById('initial-state').textContent));

async function refresh(force) {
  if (!force && busy()) return;
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (response.ok) render(await response.json());
  } catch {
    // The orchestrator is stopped or restarting: keep showing the last state.
  }
}
setInterval(refresh, REFRESH_MS);
`;
