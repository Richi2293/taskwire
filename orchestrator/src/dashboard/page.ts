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
<main class="page">
  <div class="top">
    <p class="brand"><strong>taskwire</strong> <span>orchestrator</span></p>
    <header class="control" aria-label="Agents">
      <div class="control-row">
        <p class="control-state"><span id="state-chip" class="state-chip"><span id="state-dot" class="dot"></span><span id="state" class="state"></span></span><span id="state-hint" class="state-hint"></span></p>
        <div class="control-side">
          <p class="meta">
            <span id="sync" class="sync" role="status"><span id="sync-spinner" class="spinner" hidden></span><span id="sync-text"></span></span>
            <button id="refresh" class="quiet" type="button">Refresh</button>
            <button id="details-toggle" class="quiet" type="button" aria-expanded="false" aria-controls="details"></button>
          </p>
          <button id="switch" type="button"></button>
        </div>
      </div>
      <div id="details" class="details" hidden>
        <p id="details-title" class="section-label"></p>
        <div id="details-cols" class="details-cols"></div>
      </div>
    </header>
  </div>

  <section aria-labelledby="projects-title">
    <div class="section-head">
      <h2 id="projects-title">Projects</h2>
      <span class="head-side"><span id="projects-count" class="muted small"></span><button id="add-toggle" class="btn small-btn" type="button" aria-expanded="false" aria-controls="add-project">Add project</button></span>
    </div>
    <div id="add-project" class="panel add-project" hidden>
      <div class="add-head">
        <p class="add-title">Add a project</p>
        <button id="add-close" class="quiet" type="button">Close</button>
      </div>
      <p class="muted small">Only folders set up with taskwire (they have a <code>.taskwire.json</code>) can be added. For a new one, run <code>taskwire setup</code> in it first.</p>
      <label class="field"><span class="section-label">Test command, optional</span><input id="add-test" type="text" placeholder="npm test" autocomplete="off" spellcheck="false"></label>
      <div>
        <p class="section-label">Found on this Mac</p>
        <p id="add-roots" class="muted small"></p>
        <div id="add-found" class="found"></div>
      </div>
      <div>
        <p class="section-label">Or paste the folder path</p>
        <div class="path-row">
          <input id="add-path" type="text" placeholder="/Users/you/code/website" aria-label="Folder path" autocomplete="off" spellcheck="false">
          <button id="add-path-follow" class="btn primary" type="button">Add</button>
        </div>
      </div>
      <p class="after">When agents are working, an agent may take a task in the new project at the next check. To keep agents away from some tasks, tag them <code>no-agent</code> first.</p>
      <p id="add-result" class="result" role="status"></p>
    </div>
    <div id="projects" class="panel projects"></div>
    <p id="projects-result" class="result" role="status"></p>
  </section>

  <div class="work">
    <section class="queue" aria-labelledby="queue-title">
      <div class="section-head start">
        <h2 id="queue-title">Waiting for you</h2>
        <span id="queue-count" class="count"></span>
      </div>
      <div id="project-filters" class="filters projects-filter" role="group" aria-label="Projects" hidden></div>
      <div id="filters" class="filters" role="group" aria-label="Show"></div>
      <div id="queue" class="panel queue-list"></div>
    </section>
    <section id="detail" class="panel detail" aria-live="polite"></section>
  </div>

  <section aria-labelledby="history-title">
    <div class="section-head"><h2 id="history-title">Done recently</h2></div>
    <div id="history"></div>
  </section>
  <dialog id="merge-dialog" class="modal merge-dialog" aria-labelledby="merge-title"></dialog>
  <dialog id="confirm-dialog" class="modal" aria-labelledby="confirm-title"></dialog>
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
  --bg: #f4f6f8; --panel: #ffffff; --raised: #ffffff; --ink: #0d1117; --muted: #5a6470; --line: #dde2e8; --line-strong: #c4cbd3;
  --decision: #a35f00; --decision-soft: #fff3e0; --test: #0a6aa1; --test-soft: #e6f3fa; --review: #067a4b; --review-soft: #e4f5ec;
  --alive: #067a4b; --problem: #b42318; --primary-bg: #0d1117; --primary-ink: #ffffff; --code: #eaeef2;
  --mono: ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #07090d; --panel: #0e131a; --raised: #131a23; --ink: #e8edf2; --muted: #8f9ba8; --line: #1e2731; --line-strong: #2b3643;
    --decision: #ffc46b; --decision-soft: #2a2012; --test: #6ad8ff; --test-soft: #0f2330; --review: #3dffa8; --review-soft: #0e2a1e;
    --alive: #3dffa8; --problem: #ff8a7a; --primary-bg: #3dffa8; --primary-ink: #07090d; --code: #1a222c;
  }
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
.page { max-width: 1344px; margin: 0 auto; padding: 28px 24px 64px; display: flex; flex-direction: column; gap: 28px; }
h2 { font-size: 1.2rem; font-weight: 600; margin: 0; }
p { margin: 0; }
a { color: inherit; text-underline-offset: 3px; }
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible, a:focus-visible, textarea:focus-visible, summary:focus-visible { outline: 2px solid var(--test); outline-offset: 2px; }
code { font-family: var(--mono); font-size: 0.88em; background: var(--code); border-radius: 3px; padding: 0 3px; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
.section-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.section-head.start { justify-content: flex-start; }
.section-label { font-size: 13px; font-weight: 600; color: var(--muted); margin-bottom: 8px; }
.count { font-family: var(--mono); color: var(--muted); font-size: 1.1rem; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--line-strong); flex: none; }
.dot.alive { background: var(--alive); }

.btn { border-radius: 8px; padding: 9px 18px; border: 1px solid var(--line-strong); background: transparent; font-weight: 500; display: inline-flex; align-items: center; gap: 8px; }
.btn.primary { background: var(--primary-bg); color: var(--primary-ink); border-color: var(--primary-bg); font-weight: 600; }
.btn.danger { background: var(--problem); color: var(--panel); border-color: var(--problem); font-weight: 600; }
.btn:disabled { opacity: 0.55; cursor: default; }
.link { background: none; border: 0; padding: 0; color: var(--test); font-size: 13px; text-align: left; }
.link:disabled { color: var(--muted); cursor: default; }
.quiet { background: none; border: 0; padding: 0; color: var(--muted); font-size: 13px; }

.top { display: flex; flex-direction: column; gap: 10px; }
.brand { font-size: 12px; color: var(--muted); padding: 0 4px; }
.brand strong { font-weight: 600; }
.brand span { margin-left: 2px; }
.control { background: var(--panel); border-radius: 12px; }
.control-row { display: flex; justify-content: space-between; align-items: center; gap: 12px 24px; padding: 12px 14px 12px 12px; flex-wrap: wrap; }
.control-state { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.state-chip { display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 999px; background: var(--bg); font-size: 13px; }
.state-chip .dot { width: 7px; height: 7px; }
.state { font-weight: 500; }
.state.alive { color: var(--alive); }
.state-hint { color: var(--muted); font-size: 13px; }
.control-side { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
.meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
.meta .quiet { font-size: 12px; }
.meta .quiet:hover { color: var(--ink); }
.meta > :not([hidden]) ~ :not([hidden])::before { content: '\\00B7'; color: var(--line-strong); margin-right: 8px; }
.sync { display: inline-flex; align-items: center; gap: 8px; }
.spinner { display: inline-block; width: 11px; height: 11px; border: 2px solid var(--line-strong); border-top-color: var(--test); border-radius: 50%; animation: spin 0.8s linear infinite; flex: none; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; border-color: var(--test); } }
.projects .name { display: inline-flex; align-items: center; gap: 8px; }
#switch { padding: 7px 14px; font-size: 13px; background: var(--bg); border-color: transparent; }
#switch.soft { background: var(--review-soft); color: var(--review); font-weight: 600; }
.details { border-top: 1px solid var(--line); padding: 14px 14px 16px; }
.details-cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.details-cols div { background: var(--bg); border-radius: 8px; padding: 12px 14px; }
.details-cols strong { display: block; margin-bottom: 4px; }
.details-cols p { color: var(--muted); font-size: 13px; }

.head-side { display: inline-flex; align-items: center; gap: 14px; }
.small-btn { padding: 5px 12px; font-size: 13px; }
.add-project { padding: 20px 24px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 16px; }
.add-head { display: flex; justify-content: space-between; align-items: center; }
.add-title { font-weight: 600; }
.field { display: flex; flex-direction: column; max-width: 360px; }
.field .section-label { margin-bottom: 6px; }
input[type="text"] { width: 100%; font: inherit; font-family: var(--mono); font-size: 14px; color: var(--ink); background: var(--bg); border: 1px solid var(--line-strong); border-radius: 8px; padding: 9px 12px; }
input[type="text"]:focus-visible { outline: 2px solid var(--test); outline-offset: 2px; }
.found { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin-top: 8px; }
.found:empty { display: none; }
.found .row { display: flex; align-items: center; gap: 16px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
.found .row:last-child { border-bottom: 0; }
.found .row span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.found .row small { display: block; font-family: var(--mono); font-size: 12px; color: var(--muted); }
.path-row { display: flex; gap: 10px; }
.projects .row { display: grid; grid-template-columns: 140px auto minmax(200px, 340px) minmax(0, 1fr) auto auto auto; align-items: center; gap: 24px; padding: 14px 20px; border-bottom: 1px solid var(--line); }
.projects .row:last-child { border-bottom: 0; }
.projects .name { font-weight: 600; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip { border-radius: 999px; padding: 3px 10px; font-size: 13px; }
.chip b { font-family: var(--mono); font-weight: 600; margin-right: 5px; }
.chip.decision { background: var(--decision-soft); color: var(--decision); }
.chip.test { background: var(--test-soft); color: var(--test); }
.chip.review { background: var(--review-soft); color: var(--review); }
.at-work { display: flex; align-items: center; gap: 8px; font-size: 13px; min-width: 0; }
.at-work.error { color: var(--problem); }
.done { font-size: 13px; color: var(--muted); text-align: right; }
.projects .row.off .name, .projects .row.off .at-work, .projects .row.off .done { opacity: 0.55; }
.projects .name small { display: block; font-weight: 400; font-size: 12px; color: var(--muted); }
.projects .place-form { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 240px) auto auto; gap: 12px 24px; align-items: end; justify-content: start; }
.projects .place-form .field { max-width: none; }
.projects .place-form .area-value { margin: 0; padding: 8px 0; font-size: 13px; color: var(--muted); }
.projects .place-form .area-value code { margin-right: 6px; color: var(--ink); }
.projects .place-form .main { display: flex; align-items: center; gap: 12px; }
.projects .place-form .hint { grid-column: 1 / -1; margin: 0; font-size: 13px; color: var(--muted); }
.projects .row .analysis { grid-column: 1 / -1; margin: -12px 0 0; font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
.projects .row .analysis.error { color: var(--problem); }
.switch { display: inline-flex; align-items: center; gap: 8px; background: none; border: 0; padding: 0; font-size: 13px; color: var(--muted); white-space: nowrap; }
.switch[aria-checked="true"] { color: var(--ink); }
.switch .track { position: relative; width: 30px; height: 18px; border-radius: 999px; background: var(--line-strong); flex: none; transition: background 0.15s; }
.switch .track::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--panel); transition: transform 0.15s; }
.switch[aria-checked="true"] .track { background: var(--alive); }
.switch[aria-checked="true"] .track::after { transform: translateX(12px); }
.switch:disabled { opacity: 0.55; cursor: default; }
@media (prefers-reduced-motion: reduce) { .switch .track, .switch .track::after { transition: none; } }

.work { display: grid; grid-template-columns: minmax(0, 520px) minmax(0, 1fr); gap: 20px; align-items: start; }
.filters { display: inline-flex; gap: 4px; padding: 3px; border-radius: 8px; background: var(--panel); border: 1px solid var(--line); margin-bottom: 12px; flex-wrap: wrap; }
.filters button { border: 1px solid transparent; background: none; border-radius: 6px; padding: 5px 12px; font-size: 13px; color: var(--muted); }
.filters button[aria-pressed="true"] { background: var(--raised); border-color: var(--line-strong); color: var(--ink); font-weight: 600; }
.filters small { font-family: var(--mono); margin-left: 6px; color: var(--muted); }
.projects-filter { display: flex; width: fit-content; max-width: 100%; margin-bottom: 8px; }
button.chip { border: 0; cursor: pointer; }
button.chip:hover { text-decoration: underline; text-underline-offset: 3px; }
.queue-list { overflow: hidden; padding-bottom: 6px; }
.group { display: flex; align-items: center; gap: 8px; padding: 14px 16px 6px; font-size: 12px; font-weight: 600; }
.group i { width: 8px; height: 8px; border-radius: 2px; }
.group small { font-family: var(--mono); color: var(--muted); font-weight: 400; }
.group.decision { color: var(--decision); } .group.decision i { background: var(--decision); }
.group.test { color: var(--test); } .group.test i { background: var(--test); }
.group.review { color: var(--review); } .group.review i { background: var(--review); }
.item { display: flex; width: 100%; gap: 12px; align-items: center; text-align: left; background: none; border: 0; border-left: 3px solid transparent; padding: 10px 16px 10px 13px; }
.item:hover { background: var(--bg); }
.item[aria-pressed="true"] { font-weight: 600; }
.item[aria-pressed="true"].decision { background: var(--decision-soft); border-left-color: var(--decision); }
.item[aria-pressed="true"].test { background: var(--test-soft); border-left-color: var(--test); }
.item[aria-pressed="true"].review { background: var(--review-soft); border-left-color: var(--review); }
.item span { flex: 1; min-width: 0; }
.item small { display: block; font-size: 12px; color: var(--muted); font-weight: 400; }
.item time { font-family: var(--mono); font-size: 12px; color: var(--muted); font-weight: 400; }
.more { padding: 6px 16px 10px; }
.empty { padding: 20px 16px; color: var(--muted); }

.detail { padding: 24px 28px; display: flex; flex-direction: column; gap: 22px; }
.meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
.pill { border-radius: 999px; padding: 4px 10px; font-weight: 600; }
.pill.decision { background: var(--decision-soft); color: var(--decision); }
.pill.test { background: var(--test-soft); color: var(--test); }
.pill.review { background: var(--review-soft); color: var(--review); }
.pill.live { background: var(--bg); color: var(--ink); }
.group.live { color: var(--ink); } .group.live i { background: var(--muted); }
.item[aria-pressed="true"].live { background: var(--bg); border-left-color: var(--muted); }
.merge-pill { display: inline-flex; align-items: center; gap: 6px; justify-self: start; border: 1px solid var(--line-strong); background: transparent; color: var(--muted); border-radius: 6px; padding: 4px 9px; font-size: 12px; font-weight: 500; white-space: nowrap; }
.merge-pill.dev { border-color: var(--test); color: var(--test); background: var(--test-soft); }
.merge-pill.main { border-color: var(--decision); color: var(--decision); background: var(--decision-soft); }
.icon { display: inline-flex; flex: none; }
.icon svg { display: block; }
.modal { width: min(540px, calc(100vw - 32px)); padding: 24px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--raised); color: var(--ink); }
.modal::backdrop { background: rgba(7, 9, 13, 0.6); }
.modal h2 { font-size: 16px; }
.modal .sub { color: var(--muted); font-size: 13px; margin: 4px 0 18px; }
.modal footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
#confirm-dialog { width: min(440px, calc(100vw - 32px)); }
.merge-options { display: flex; flex-direction: column; gap: 8px; }
.merge-option { display: flex; gap: 12px; align-items: flex-start; width: 100%; text-align: left; padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
.merge-option .radio { width: 16px; height: 16px; border-radius: 50%; border: 1.5px solid var(--line-strong); flex: none; margin-top: 2px; }
.merge-option[aria-checked="true"] .radio { border: 5px solid currentColor; }
.merge-option b { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; }
.merge-option small { display: block; color: var(--muted); font-size: 13px; margin-top: 4px; }
.merge-option.none .icon { color: var(--muted); }
.merge-option.dev .icon { color: var(--test); }
.merge-option.main .icon { color: var(--decision); }
.merge-option[aria-checked="true"].none { border-color: var(--line-strong); }
.merge-option[aria-checked="true"].dev { border-color: var(--test); background: var(--test-soft); color: var(--test); }
.merge-option[aria-checked="true"].main { border-color: var(--decision); background: var(--decision-soft); color: var(--decision); }
.merge-confirm { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); font-size: 13px; }
.merge-confirm input { font-family: var(--mono); }
.merge-dialog .branches { font-family: var(--mono); font-size: 12px; color: var(--muted); margin-top: 14px; }
.item.live { cursor: pointer; }
.item .status { font-size: 12px; color: var(--muted); }
.group.live .icon { color: var(--ink); }
.detail h3 { font-size: 1.5rem; line-height: 1.2; margin: 0 0 6px; font-weight: 600; }
.detail h3 a { text-decoration: none; }
.goal { color: var(--muted); }
.numbered { margin: 0; padding: 0; list-style: none; counter-reset: n; display: flex; flex-direction: column; gap: 10px; }
.numbered li { counter-increment: n; display: flex; gap: 12px; }
.numbered li::before { content: counter(n); font-family: var(--mono); font-size: 13px; width: 16px; flex: none; padding-top: 2px; }
.numbered.decision li::before { color: var(--decision); }
.numbered.test li::before { color: var(--test); }
.checked { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; }
.checked li::before { content: "\\2713"; color: var(--review); margin-right: 10px; }
.note { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; overflow-wrap: anywhere; }
.proposal { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; }
textarea { width: 100%; min-height: 104px; font: inherit; color: var(--ink); background: var(--bg); border: 1px solid var(--line-strong); border-radius: 8px; padding: 12px 14px; resize: vertical; }
.actions { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.actions .main, .actions .side { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.actions .side { gap: 18px; }
.actions .side a { color: var(--muted); font-size: 13px; }
details.menu { position: relative; font-size: 13px; color: var(--muted); }
.projects details.menu div { top: 22px; }
#projects-result { margin-top: 8px; }
details.menu summary { cursor: pointer; list-style: none; }
details.menu summary::-webkit-details-marker { display: none; }
details.menu div { display: flex; flex-direction: column; gap: 2px; position: absolute; right: 0; top: 24px; background: var(--raised); border: 1px solid var(--line-strong); border-radius: 8px; padding: 6px; z-index: 2; white-space: nowrap; }
details.menu div button { background: none; border: 0; padding: 6px 10px; border-radius: 6px; width: 100%; text-align: left; }
details.menu div button:hover { background: var(--bg); }
details.menu div button.danger { color: var(--problem); }
.after { font-size: 13px; color: var(--muted); }
.result { font-size: 14px; }
.result:empty { display: none; }
.result.failed { color: var(--problem); }

.timeline { list-style: none; margin: 0; padding: 0; border-left: 2px solid var(--line); margin-left: 3.4rem; }
.timeline li { position: relative; padding: 0 0 14px 18px; }
.timeline li::before { content: ""; position: absolute; left: -6px; top: 7px; width: 10px; height: 10px; border-radius: 50%; background: var(--bg); border: 2px solid var(--muted); }
.timeline li[data-needs="review"]::before { border-color: var(--review); }
.timeline li[data-needs="test"]::before { border-color: var(--test); }
.timeline li[data-needs="decision"]::before { border-color: var(--decision); }
.timeline time { position: absolute; left: -3.8rem; top: 1px; width: 3.2rem; text-align: right; font-family: var(--mono); font-size: 13px; color: var(--muted); }
.timeline p { color: var(--muted); font-size: 13px; }
.day { font-size: 13px; color: var(--muted); font-weight: 600; margin: 18px 0 8px; }

@media (max-width: 900px) {
  .work { grid-template-columns: minmax(0, 1fr); }
  .details-cols { grid-template-columns: minmax(0, 1fr); }
  .projects .row { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .path-row { flex-direction: column; }
  .projects details.menu div { left: 0; right: auto; }
  .done { text-align: left; }
  .control-row { align-items: flex-start; }
  .detail { padding: 20px; }
}
@media (max-width: 520px) {
  .page { padding: 16px 12px 48px; }
  .timeline { margin-left: 0; border-left: 0; }
  .timeline li { padding-left: 0; }
  .timeline li::before { display: none; }
  .timeline time { position: static; display: block; text-align: left; }
}
`;

// Runs in the browser. Builds every element with createElement and textContent only.
const SCRIPT = `
const TOKEN = document.querySelector('meta[name="action-token"]').content;
const KIND = {
  live: { pill: 'In production', group: 'Live, close it', filter: 'To close' },
  decision: { pill: 'Your decision', group: 'Decide', filter: 'Decide' },
  test: { pill: 'Try it by hand', group: 'Try by hand', filter: 'Try by hand' },
  review: { pill: 'Review and merge', group: 'Review and merge', filter: 'Review' },
};
const ORDER = ['decision', 'test', 'review'];
// Lucide icons (ISC license), as shapes drawn with the DOM: the page loads nothing from outside and writes no HTML.
const ICONS = {
  none: [['rect', { width: '18', height: '11', x: '3', y: '11', rx: '2', ry: '2' }], ['path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' }]],
  dev: [['circle', { cx: '18', cy: '18', r: '3' }], ['circle', { cx: '6', cy: '6', r: '3' }], ['path', { d: 'M6 21V9a9 9 0 0 0 9 9' }]],
  main: [
    ['path', { d: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z' }],
    ['path', { d: 'm12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z' }],
    ['path', { d: 'M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0' }],
    ['path', { d: 'M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5' }],
  ],
};
const SVG_NS = 'http://www.w3.org/2000/svg';
// The queue also lists the live tasks, after what waits for a decision, a test or a review.
const QUEUE_ORDER = [...ORDER, 'live'];
const MERGE = {
  none: { label: 'PR only', text: 'Agents open a pull request. You review and merge it.' },
  dev: { label: 'Auto to dev', text: 'The orchestrator merges verified tasks into staging. You release staging to production.' },
  main: { label: 'Auto to main', text: 'Also releases staging to production after each task, when its CI is green and no task waits for a test by hand.' },
};
const GROUP_LIMIT = 3;
const REFRESH_MS = 30000;
// While the orchestrator reads the task system, the page asks more often, to show the new data as soon as it arrives.
const READING_MS = 3000;
const DONE = {
  answer: 'Answer sent. An agent takes the task up at the next check.',
  'accept-proposal': 'Proposal accepted. An agent takes the task up at the next check.',
  approve: 'Done. The task left your queue.',
  'send-back': 'Sent back. An agent takes the task up again at the next check.',
  block: 'Agents will keep away from this task.',
  'accept-task': 'Task accepted. An agent may take it at the next check.',
  'reject-task': 'Task rejected and closed.',
  close: 'Task closed.',
  'close-live': 'Task closed.',
};

// The projects the queue is narrowed to, kept in this browser only: an empty set shows every project.
const PROJECTS_KEY = 'taskwire-orchestrator.queue-projects';

function savedProjects() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
    return new Set(Array.isArray(saved) ? saved.filter((path) => typeof path === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveProjects() {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify([...ui.projects]));
  } catch {
    // Storage may be blocked: the choice then lasts until the page is reloaded.
  }
}

const ui = { state: null, selected: null, filter: 'all', projects: savedProjects(), open: new Set(), details: false, placing: null, merge: null };

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null) continue;
    if (key === 'text') node.textContent = value;
    else if (key.startsWith('data-') || key.startsWith('aria-') || key === 'role') node.setAttribute(key, value);
    else node[key] = value;
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
  return node;
}

// Text with \\\`code\\\` spans, as agents write, turned into text and code nodes.
function inline(text) {
  return text.split(/\\\`([^\\\`]+)\\\`/).map((part, index) => (index % 2 ? el('code', { text: part }) : part));
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function duration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return minutes + (minutes === 1 ? ' minute' : ' minutes');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours + (hours === 1 ? ' hour' : ' hours');
  const days = Math.round(hours / 24);
  return days + (days === 1 ? ' day' : ' days');
}

function short(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return minutes + ' min';
  if (minutes < 60 * 24) return Math.round(minutes / 60) + ' h';
  return Math.round(minutes / 1440) + ' d';
}

// One of the icons above.
function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = { viewBox: '0 0 24 24', width: '13', height: '13', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' };
  for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, value);
  for (const [tag, shape] of ICONS[name]) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(shape)) node.setAttribute(key, value);
    svg.append(node);
  }
  return el('span', { className: 'icon' }, svg);
}

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

// A goal that only repeats the task name adds nothing.
function sameText(a, b) {
  const plain = (text) => text.toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, ' ').trim();
  return plain(a) === plain(b);
}

function keyOf(item) {
  // A task can be live and waiting again (sent back after its release): the two items need their own keys.
  return (item.needs === 'live' ? 'live:' : '') + item.project + '#' + item.id;
}

function renderControl(state) {
  const c = state.control;
  const now = new Date(state.generatedAt);
  const working = c.mode === 'working';
  document.getElementById('state-dot').className = working ? 'dot alive' : 'dot';
  const title = document.getElementById('state');
  title.textContent = working ? 'Working' : 'Paused';
  title.className = working ? 'state alive' : 'state';
  let hint;
  if (working) {
    const next = c.nextCheckAt ? ' Next check at ' + clock(c.nextCheckAt) + '.' : ' Looking for tasks now.';
    hint = (c.agentsAtWork ? plural(c.agentsAtWork, 'agent') + ' at work.' : 'No agent at work right now.') + next;
  } else if (c.agentsAtWork) {
    hint = plural(c.agentsAtWork, 'agent') + ' finishing a task. No new task starts.';
  } else {
    hint = 'No agent is working. Start them when you are ready.';
  }
  document.getElementById('state-hint').textContent = hint;

  const button = document.getElementById('switch');
  button.className = working ? 'btn' : 'btn soft';
  button.replaceChildren(working ? 'Pause' : 'Start agents');
  button.disabled = false;
  button.onclick = () => switchMode(working ? 'pause' : 'play', button);

  const toggle = document.getElementById('details-toggle');
  toggle.textContent = 'Details' + (ui.details ? ' \\u25B4' : ' \\u25BE');
  toggle.setAttribute('aria-expanded', String(ui.details));
  toggle.onclick = () => { ui.details = !ui.details; renderControl(ui.state); };
  document.getElementById('details').hidden = !ui.details;
  document.getElementById('details-title').textContent = working ? 'What is happening' : 'When you press Start agents';

  const col = (title, body) => el('div', {}, el('strong', { text: title }), el('p', { text: body }));
  let cols;
  if (working) {
    const first = state.working[0];
    // A project whose group has an agent at work waits for it: one agent at a time works in a group.
    const busyGroups = state.projects.filter((p) => p.working && p.group).map((p) => p.group);
    const idle = state.projects.filter((p) => !p.working && p.agents);
    const free = idle.filter((p) => !busyGroups.includes(p.group)).map((p) => p.projectName);
    const waitingGroup = idle.filter((p) => busyGroups.includes(p.group)).map((p) => p.projectName);
    const room = c.maxAgents - c.agentsAtWork;
    cols = [
      col('Now', first
        ? (first.kind === 'analysis'
          ? 'An agent analyses ' + first.projectName + ', for ' + duration(now - new Date(first.startedAt)) + ': it reviews the tasks, checks the work waiting for you and may propose new tasks.'
          : 'An agent works on "' + first.name + '" in ' + first.projectName + ', for ' + duration(now - new Date(first.startedAt)) + '. When it is done, the project tests and an independent check run.')
          + (state.working.length > 1 ? ' ' + plural(state.working.length - 1, 'more agent') + ' at work.' : '')
        : 'No agent is working right now.'),
      col(c.nextCheckAt ? 'Next check at ' + clock(c.nextCheckAt) : 'Checking now',
        (c.nextCheckAt ? 'In ' + duration(new Date(c.nextCheckAt) - now) + ' the' : 'The') + ' orchestrator looks for new tasks' + (free.length ? ' in ' + free.join(', ') : '') + '.'
        + (c.busyProjects.length ? ' ' + c.busyProjects.join(', ') + (c.busyProjects.length === 1 ? ' is' : ' are') + ' busy until its agent finishes.' : '')
        + (waitingGroup.length ? ' ' + waitingGroup.join(', ') + (waitingGroup.length === 1 ? ' waits' : ' wait') + ' for the agent of its group.' : '')),
      col(c.agentsAtWork + ' of ' + c.maxAgents + ' agents in use',
        (room > 0 ? plural(room, 'more agent') + ' can start at the next check. ' : 'No room for another agent until one finishes. ') + 'Pause stops new work; an agent at work finishes its task first.'),
    ];
  } else {
    const on = state.projects.filter((p) => p.agents);
    const due = on.filter((p) => p.analysisDue).map((p) => p.projectName);
    const task = c.firstTask ? 'An agent takes "' + c.firstTask.name + '" in ' + c.firstTask.projectName + ', the next task with nothing waiting.' : 'No task is ready now: an agent starts as soon as one appears.';
    cols = [
      col('Right away', due.length
        ? 'An agent first analyses ' + due.join(', ') + ': it reviews the tasks, checks the work waiting for you and may propose new tasks. Then the tasks start.'
        : task),
      col('Then every ' + c.intervalMinutes + ' minutes', on.length
        ? 'The orchestrator looks for new tasks in your ' + plural(on.length, 'project') + ' with agents on and starts an agent where there is room.'
        : 'Agents are off in every project: turn them on in a project row.'),
      col('At most ' + c.maxAgents + ' agents at once', 'One agent per project, and one per group of projects that share a task list. Pause stops new work; an agent at work finishes its task first.'),
    ];
  }
  document.getElementById('details-cols').replaceChildren(...cols);
}

function ago(iso, now) {
  return duration(now - new Date(iso)) + ' ago';
}

function renderSync(state) {
  const now = new Date(state.generatedAt);
  const sync = state.sync;
  const failed = state.projects.filter((p) => p.error).length;
  let text;
  if (!state.projects.length) text = '';
  else if (sync.reading && !sync.readAt) text = 'Reading your projects from ClickUp.';
  else if (sync.reading) text = 'Updating from ClickUp. Showing data from ' + ago(sync.readAt, now) + '.';
  else if (sync.readAt) text = 'Updated ' + ago(sync.readAt, now);
  else text = 'Not read from ClickUp yet.';
  if (failed && !sync.reading) text += (text.endsWith('.') ? ' ' : '. ') + (failed === 1 ? 'One project' : failed + ' projects') + ' could not be updated.';
  document.getElementById('sync-text').textContent = text;
  document.getElementById('sync').hidden = !text;
  document.getElementById('sync-spinner').hidden = !sync.reading;
  const button = document.getElementById('refresh');
  button.hidden = !state.projects.length;
  button.disabled = sync.reading;
}

function renderProjects(state) {
  const now = new Date(state.generatedAt);
  document.getElementById('projects-count').textContent = plural(state.projects.length, 'project') + ' followed';
  const label = { decision: 'to decide', test: 'to try', review: 'to review' };
  const rows = state.projects.map((p) => {
    const chips = ORDER.filter((k) => p.waiting[k]).map((k) => el('button', {
      type: 'button', className: 'chip ' + k, title: 'Show only these tasks of ' + p.projectName, onclick: () => focusQueue(p.project, k),
    }, el('b', { text: String(p.waiting[k]) }), label[k]));
    let doing = p.agents ? 'No agent at work' : 'Agents off: no new task starts here';
    if (p.working) doing = 'Agent at work: ' + p.working.name + ', for ' + duration(now - new Date(p.working.startedAt)) + (p.agents ? '' : '. No new task after it');
    // A failed read keeps the last data: the row says why it is not up to date.
    const work = p.error
      ? el('div', { className: 'at-work error', text: 'Could not update: ' + p.error.replace(/\\.?$/, '.') + (p.readAt ? ' Data from ' + ago(p.readAt, now) + '.' : '') })
      : el('div', { className: 'at-work' }, el('span', { className: p.working ? 'dot alive' : 'dot' }), doing);
    // Off keeps the project followed: what waits for the person still shows, only new work stops.
    const agents = el('button', { type: 'button', className: 'switch', role: 'switch', 'aria-checked': String(p.agents), title: p.agents ? 'Agents may take tasks of this project' : 'Agents take no new task of this project' },
      el('span', { className: 'track' }), p.agents ? 'Agents on' : 'Agents off');
    agents.onclick = () => switchAgents(p, agents);
    let empty = 'Nothing waits for you';
    if (!p.readAt) empty = p.reading ? 'Reading from ClickUp' : 'Not read yet';
    return el('div', { className: p.agents ? 'row' : 'row off' },
      el('span', { className: 'name' }, el('span', {}, p.projectName, placeText(p) ? el('small', { text: placeText(p) }) : null), p.reading ? el('span', { className: 'spinner', title: 'Updating from ClickUp', 'aria-label': 'Updating from ClickUp' }) : null),
      el('button', { type: 'button', className: 'merge-pill ' + p.merge, title: 'Who merges the work of ' + p.projectName + '. Press to change it.', onclick: () => openMerge(p) }, icon(p.merge), MERGE[p.merge].label),
      el('div', { className: 'chips' }, chips.length ? chips : el('span', { className: 'muted small', text: empty })),
      work,
      el('span', { className: 'done', text: p.doneToday ? p.doneToday + ' done today' : 'Nothing done today' }),
      agents,
      el('details', { className: 'menu' }, el('summary', { text: 'More' }),
        el('div', {},
          el('button', { type: 'button', text: 'Set group', onclick: () => { ui.placing = p.project; renderProjects(ui.state); } }),
          el('button', { type: 'button', className: 'danger', text: 'Remove project', onclick: () => unfollow(p) }))),
      ui.placing === p.project ? placeForm(p) : null,
      releaseLine(p),
      analysisLine(p, now));
  });
  const box = document.getElementById('projects');
  box.replaceChildren(...rows);
  if (!rows.length) box.replaceChildren(el('p', { className: 'empty', text: 'No project yet. Press Add project to add one.' }));
}

// The area and the group of a project that shares its task list, for its row.
function placeText(p) {
  if (!p.area && !p.group) return '';
  return (p.area ? 'Area ' + p.area : 'No area') + (p.group ? ', ' + p.group : '');
}

// Sets the group of a project; an empty field removes it. The area lives in the project's .taskwire.json, so it is only shown.
function placeForm(p) {
  const group = el('input', { type: 'text', value: p.group || '', placeholder: 'Acme', 'aria-label': 'Group', autocomplete: 'off', spellcheck: false });
  const form = el('div', { className: 'place-form' },
    el('label', { className: 'field' }, el('span', { className: 'section-label', text: 'Group' }), group),
    el('div', { className: 'field' },
      el('span', { className: 'section-label', text: 'Area, from taskwire' }),
      el('p', { className: 'area-value' }, el('code', { text: p.area || 'none' }), ' To change it, run taskwire area set <tag> in the project.')),
    el('div', { className: 'main' },
      el('button', { type: 'button', className: 'btn primary', text: 'Save', onclick: () => saveGroup(p, group.value, form) }),
      el('button', { type: 'button', className: 'quiet', text: 'Cancel', onclick: () => { ui.placing = null; renderProjects(ui.state); } })),
    el('p', { className: 'hint', text: "Group: the product this project belongs to, with the other projects of its task list. One agent at a time works in a group. Leave it empty for no group. The area is the tag of the project's tasks and lives in its .taskwire.json, so every agent and the CLI see the same one." }));
  return form;
}

async function saveGroup(p, group, form) {
  const result = document.getElementById('projects-result');
  for (const control of form.querySelectorAll('button, input')) control.disabled = true;
  try {
    await post('/api/projects', { action: 'group', project: p.project, group });
    ui.placing = null;
    result.className = 'result';
    result.textContent = '';
  } catch (error) {
    result.className = 'result failed';
    result.textContent = error.message;
    for (const control of form.querySelectorAll('button, input')) control.disabled = false;
    return;
  }
  refresh(true);
}

// Who merges the work of the project, in a modal. Production without a person asks to type the project name, as the server does.
function openMerge(p) {
  ui.merge = { project: p.project, level: p.merge, confirm: '' };
  renderMergeDialog();
  document.getElementById('merge-dialog').showModal();
}

function renderMergeDialog() {
  const dialog = document.getElementById('merge-dialog');
  const p = ui.merge && ui.state.projects.find((entry) => entry.project === ui.merge.project);
  if (!p) {
    dialog.close();
    return;
  }
  const options = Object.keys(MERGE).map((key) => el('button', {
    type: 'button', role: 'radio', 'aria-checked': String(ui.merge.level === key), className: 'merge-option ' + key,
    onclick: () => { ui.merge.level = key; renderMergeDialog(); },
  }, el('span', { className: 'radio' }), el('span', {}, el('b', {}, icon(key), MERGE[key].label), el('small', { text: MERGE[key].text }))));
  const input = el('input', { type: 'text', value: ui.merge.confirm, placeholder: p.projectName, 'aria-label': 'Project name', autocomplete: 'off', spellcheck: false });
  input.oninput = () => { ui.merge.confirm = input.value; };
  const result = el('p', { className: 'result', role: 'status' });
  const parts = [
    el('h2', { id: 'merge-title', text: 'Who merges the work of ' + p.projectName }),
    el('p', { className: 'sub', text: 'Agents never merge. The orchestrator merges only tasks that pass the tests, the independent check and the CI of the pull request.' }),
    el('div', { className: 'merge-options', role: 'radiogroup', 'aria-label': 'Who merges' }, ...options),
    ui.merge.level === 'main' && p.merge !== 'main'
      ? el('label', { className: 'merge-confirm' }, el('span', { text: 'Work reaches production without a person. Type the project name to confirm.' }), input)
      : null,
    el('p', { className: 'branches', text: 'Staging ' + p.stagingBranch + ', production ' + (p.productionBranch || 'the default branch') }),
    result,
    el('footer', {},
      el('button', { type: 'button', className: 'btn', text: 'Cancel', onclick: () => dialog.close() }),
      el('button', { type: 'button', className: 'btn primary', text: 'Save', onclick: () => saveMerge(p, dialog, result) })),
  ];
  dialog.replaceChildren(...parts.filter((part) => part !== null));
}

async function saveMerge(p, dialog, result) {
  // Nothing changed: close, without asking for the project name again.
  if (ui.merge.level === p.merge) {
    dialog.close();
    return;
  }
  for (const control of dialog.querySelectorAll('button, input')) control.disabled = true;
  try {
    await post('/api/projects', { action: 'merge-level', project: p.project, level: ui.merge.level, confirm: ui.merge.confirm.trim() });
  } catch (error) {
    result.className = 'result failed';
    result.textContent = error.message;
    for (const control of dialog.querySelectorAll('button, input')) control.disabled = false;
    return;
  }
  dialog.close();
  refresh(true);
}

// Where the release of staging to production stands, while it waits or is blocked.
function releaseLine(p) {
  if (p.merge !== 'main' || !p.release || p.release.state === 'released') return null;
  const target = 'Release to ' + (p.productionBranch || 'production');
  const reason = p.release.reason.replace(/\\.?$/, '.');
  const text = p.release.state === 'blocked' ? target + ' is blocked: ' + reason : target + ' waits: ' + reason;
  return el('p', { className: p.release.state === 'blocked' ? 'analysis error' : 'analysis', text });
}

// What the last analysis of the project found, in the words of its agent.
function analysisLine(p, now) {
  if (p.analysis) {
    const when = 'Last analysis ' + ago(p.analysis.at, now);
    return el('p', { className: p.analysis.ok ? 'analysis' : 'analysis error', text: (p.analysis.ok ? when + ': ' : when + ' failed: ') + p.analysis.summary });
  }
  return p.agents && p.analysisDue && p.working?.kind !== 'analysis' ? el('p', { className: 'analysis', text: 'Not analysed yet: an agent analyses the project before its next task.' }) : null;
}

// Every confirmation of the page, in a modal instead of the browser confirm. Resolves true only on the action button;
// Cancel and Escape resolve false. A danger action gets the red button.
function askConfirm({ title, text, action, danger = false }) {
  const dialog = document.getElementById('confirm-dialog');
  return new Promise((resolve) => {
    const answer = (yes) => { resolve(yes); dialog.close(); };
    dialog.onclose = () => resolve(false);
    dialog.replaceChildren(
      el('h2', { id: 'confirm-title', text: title }),
      el('p', { className: 'sub', text }),
      el('footer', {},
        el('button', { type: 'button', className: 'btn', text: 'Cancel', onclick: () => answer(false) }),
        el('button', { type: 'button', className: danger ? 'btn danger' : 'btn primary', text: action, onclick: () => answer(true) })));
    dialog.showModal();
  });
}

// The folder and its tasks stay as they are: only the orchestrator stops looking at them.
async function unfollow(project) {
  const result = document.getElementById('projects-result');
  const yes = await askConfirm({
    title: 'Remove ' + project.projectName + ' from the orchestrator?',
    text: 'Agents stop working on it. Its folder and its tasks stay as they are.',
    action: 'Remove project',
    danger: true,
  });
  if (!yes) return;
  result.className = 'result';
  result.textContent = 'Removing ' + project.projectName + '.';
  try {
    await post('/api/projects', { action: 'unfollow', project: project.project });
    result.textContent = 'Removed ' + project.projectName + '. Agents no longer work on it.';
    refresh(true);
  } catch (error) {
    result.className = 'result failed';
    result.textContent = error.message;
  }
}

// The project stays followed either way; the loop reads the config at every check.
async function switchAgents(project, button) {
  const result = document.getElementById('projects-result');
  const on = !project.agents;
  button.disabled = true;
  try {
    await post('/api/projects', { action: on ? 'agents-on' : 'agents-off', project: project.project });
  } catch (error) {
    result.className = 'result failed';
    result.textContent = error.message;
  }
  refresh(true);
}

function openAdd(open) {
  document.getElementById('add-project').hidden = !open;
  const toggle = document.getElementById('add-toggle');
  toggle.setAttribute('aria-expanded', String(open));
  if (open) findProjects();
}

// The search runs on the Mac, in the folders set in projectRoots or next to the projects already followed.
async function findProjects() {
  const roots = document.getElementById('add-roots');
  const list = document.getElementById('add-found');
  roots.textContent = 'Looking for projects.';
  list.replaceChildren();
  try {
    const response = await fetch('/api/discover', { cache: 'no-store', headers: { 'x-action-token': TOKEN } });
    const found = await response.json();
    if (!response.ok) throw new Error(found.error || 'The orchestrator answered ' + response.status + '.');
    if (!found.roots.length) {
      roots.textContent = 'There is no folder to look in yet: paste the path below. To look in more folders, set projectRoots in the orchestrator config.';
      return;
    }
    const where = 'Looking in ' + found.roots.join(', ') + '.';
    roots.textContent = found.projects.length
      ? where + (found.truncated ? ' The search stopped early: paste the path below if a project is missing.' : '')
      : where + ' No other taskwire project there. Paste the path below, or set projectRoots in the orchestrator config.';
    list.replaceChildren(...found.projects.map((project) => el('div', { className: 'row' },
      el('span', {}, project.name, el('small', { text: project.path })),
      el('button', { type: 'button', className: 'btn', text: 'Add', onclick: (event) => follow(project.path, event.target) }))));
  } catch (error) {
    roots.textContent = error.message;
  }
}

async function follow(path, button) {
  const result = document.getElementById('add-result');
  const panel = document.getElementById('add-project');
  for (const control of panel.querySelectorAll('button, input')) control.disabled = true;
  result.className = 'result';
  result.textContent = 'Checking that taskwire works in ' + path + '.';
  try {
    await post('/api/projects', { action: 'follow', project: path, testCommand: document.getElementById('add-test').value });
    result.textContent = 'Added ' + path.replace(/\\/+$/, '').split('/').pop() + '. It now shows in Projects.';
    document.getElementById('add-path').value = '';
    document.getElementById('add-test').value = '';
    findProjects();
    refresh(true);
  } catch (error) {
    result.className = 'result failed';
    result.textContent = error.message;
  }
  for (const control of panel.querySelectorAll('button, input')) control.disabled = false;
  if (button) button.focus();
}

document.getElementById('add-toggle').onclick = () => openAdd(document.getElementById('add-project').hidden);
document.getElementById('add-close').onclick = () => openAdd(false);
document.getElementById('add-path-follow').onclick = () => {
  const path = document.getElementById('add-path');
  if (path.value.trim()) follow(path.value.trim()); else path.focus();
};
document.getElementById('add-path').onkeydown = (event) => {
  if (event.key === 'Enter') document.getElementById('add-path-follow').click();
};

// A waiting chip of a project row: the queue shows only that project and that kind.
function focusQueue(project, kind) {
  ui.projects = new Set([project]);
  ui.filter = kind;
  saveProjects();
  renderQueue(ui.state);
  renderDetail(ui.state);
  document.getElementById('queue-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleProject(project) {
  if (project === null) ui.projects.clear();
  else if (ui.projects.has(project)) ui.projects.delete(project);
  else ui.projects.add(project);
  saveProjects();
  renderQueue(ui.state);
  renderDetail(ui.state);
}

// One button per project with something waiting, and per project chosen even with nothing left, so a choice never hides.
function renderProjectFilters(state) {
  const followed = new Set(state.projects.map((p) => p.project));
  // A project no longer followed leaves the choice.
  for (const path of [...ui.projects]) if (!followed.has(path)) ui.projects.delete(path);
  const live = state.live || [];
  const count = (p) => p.waiting.decision + p.waiting.test + p.waiting.review + live.filter((i) => i.project === p.project).length;
  const shown = state.projects.filter((p) => count(p) > 0 || ui.projects.has(p.project));
  const box = document.getElementById('project-filters');
  // With a single project followed there is nothing to choose.
  box.hidden = state.projects.length < 2;
  box.replaceChildren(
    el('button', { type: 'button', 'aria-pressed': String(ui.projects.size === 0), onclick: () => toggleProject(null) }, 'All projects'),
    ...shown.map((p) => el('button', { type: 'button', 'aria-pressed': String(ui.projects.has(p.project)), onclick: () => toggleProject(p.project) },
      p.projectName, el('small', { text: String(count(p)) }))));
}

// What waits for the person, then the live tasks to close, as one list.
function queueItems(state) {
  const live = (state.live || []).map((i) => ({ project: i.project, projectName: i.projectName, id: i.id, name: i.name, url: i.url, needs: 'live', since: i.at, pr: i.pr }));
  return [...state.waiting, ...live];
}

function renderQueue(state) {
  const now = new Date(state.generatedAt);
  renderProjectFilters(state);
  const all = queueItems(state);
  const items = ui.projects.size ? all.filter((i) => ui.projects.has(i.project)) : all;
  document.getElementById('queue-count').textContent = String(items.length);
  const counts = { all: items.length };
  for (const k of QUEUE_ORDER) counts[k] = items.filter((i) => i.needs === k).length;
  // The To close filter shows only when there is something to close.
  const filters = QUEUE_ORDER.filter((k) => k !== 'live' || counts.live || ui.filter === 'live');
  document.getElementById('filters').replaceChildren(...['all', ...filters].map((f) =>
    el('button', { type: 'button', 'aria-pressed': String(ui.filter === f), onclick: () => { ui.filter = f; renderQueue(ui.state); renderDetail(ui.state); } },
      f === 'all' ? 'All' : KIND[f].filter, el('small', { text: String(counts[f]) }))));

  // The detail always shows a task the queue shows: the first one when the filters hide the task selected.
  const visible = ui.filter === 'all' ? items : items.filter((i) => i.needs === ui.filter);
  if (!visible.find((i) => keyOf(i) === ui.selected)) ui.selected = visible.length ? keyOf(visible[0]) : null;
  const kinds = ui.filter === 'all' ? QUEUE_ORDER : [ui.filter];
  const blocks = [];
  for (const kind of kinds) {
    const group = items.filter((i) => i.needs === kind);
    if (!group.length) continue;
    const limited = ui.filter === 'all' && !ui.open.has(kind);
    const selectedIndex = group.findIndex((i) => keyOf(i) === ui.selected);
    const shown = limited ? group.filter((_, index) => index < GROUP_LIMIT || index === selectedIndex) : group;
    blocks.push(el('p', { className: 'group ' + kind }, kind === 'live' ? icon('main') : el('i'), KIND[kind].group, el('small', { text: String(group.length) })));
    for (const item of shown) {
      if (kind === 'live') {
        blocks.push(liveRow(item, now));
        continue;
      }
      blocks.push(el('button', {
        type: 'button', className: 'item ' + kind, 'aria-pressed': String(keyOf(item) === ui.selected),
        onclick: () => selectItem(item),
      }, el('span', {}, item.name, el('small', { text: item.projectName })), item.since ? el('time', { text: short(now - new Date(item.since)) }) : null));
    }
    if (shown.length < group.length) {
      blocks.push(el('p', { className: 'more' }, el('button', { type: 'button', className: 'link', text: 'Show ' + (group.length - shown.length) + ' more', onclick: () => { ui.open.add(kind); renderQueue(ui.state); } })));
    }
  }
  const list = document.getElementById('queue');
  list.replaceChildren(...blocks);
  let empty = ui.projects.size ? 'Nothing waits for you in the selected projects.' : 'Nothing waits for you.';
  if (items.length) empty = 'Nothing of this kind waits for you' + (ui.projects.size ? ' in the selected projects.' : '.');
  if (!blocks.length) list.replaceChildren(el('p', { className: 'empty', text: empty }));
}

function selectItem(item) {
  ui.selected = keyOf(item);
  renderQueue(ui.state);
  renderDetail(ui.state);
  // On a narrow screen the detail is below the list: bring it into view.
  if (window.matchMedia('(max-width: 900px)').matches) document.getElementById('detail').scrollIntoView();
}

// A live task closes from its row; the row also selects it, like the other items.
function liveRow(item, now) {
  const status = el('span', { className: 'status', role: 'status' });
  const close = el('button', { type: 'button', className: 'btn small-btn', text: 'Close the task' });
  const row = el('div', {
    className: 'item live', role: 'button', tabIndex: 0, 'aria-pressed': String(keyOf(item) === ui.selected),
    onclick: () => selectItem(item),
    onkeydown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectItem(item); } },
  }, el('span', {}, item.name, el('small', { text: item.projectName + ', pull request #' + item.pr })), close, status, item.since ? el('time', { text: short(now - new Date(item.since)) }) : null);
  close.onclick = (event) => {
    event.stopPropagation();
    send(item, 'close-live', undefined, row, status);
  };
  return row;
}

function renderDetail(state) {
  const box = document.getElementById('detail');
  const all = queueItems(state);
  const item = all.find((i) => keyOf(i) === ui.selected);
  if (!item && all.length) {
    box.replaceChildren(el('p', { className: 'muted', text: 'No task matches the filters. Press All' + (ui.projects.size ? ' projects' : '') + ' to see the others.' }));
    return;
  }
  if (!item) {
    box.replaceChildren(el('p', { className: 'muted', text: state.control.mode === 'working'
      ? 'Nothing waits for you. Agents keep working, and new questions or checks show up here.'
      : 'Nothing waits for you. Press Start agents to let agents work on your projects.' }));
    return;
  }
  const now = new Date(state.generatedAt);
  const result = el('p', { className: 'result', role: 'status' });
  const parts = [
    el('div', { className: 'meta' }, el('span', { className: 'pill ' + item.needs, text: item.proposedTask ? 'New task proposed' : item.readyToClose ? 'Ready to close' : KIND[item.needs].pill }), item.projectName + (item.since ? ', waiting for ' + duration(now - new Date(item.since)) : '')),
    el('div', {}, el('h3', {}, el('a', { href: item.url, target: '_blank', rel: 'noopener', text: item.name })), item.goal && !sameText(item.goal, item.name) ? el('p', { className: 'goal' }, ...inline(item.goal)) : null),
  ];
  if (item.needs === 'live') {
    parts.push(el('p', { text: 'Pull request #' + item.pr + ' is in production.' }));
    parts.push(el('div', { className: 'actions' },
      el('div', { className: 'main' }, el('button', { type: 'button', className: 'btn primary', text: 'Close the task', onclick: () => send(item, 'close-live', undefined, box, result) })),
      el('div', { className: 'side' }, el('a', { href: item.url, target: '_blank', rel: 'noopener', text: 'Open in ClickUp' }))));
    parts.push(el('p', { className: 'after', text: 'Close the task moves it to the closed status of its list. The orchestrator never closes a task on its own.' }));
    parts.push(result);
    box.replaceChildren(...parts);
    return;
  }
  const note = item.note.length ? el('div', {}, el('p', { className: 'section-label', text: 'The agent says' }), el('ul', { className: 'note' }, item.note.map((line) => el('li', {}, ...inline(line))))) : null;
  const field = (label, placeholder) => el('textarea', { 'aria-label': label, placeholder });
  const side = el('div', { className: 'side' },
    el('a', { href: item.url, target: '_blank', rel: 'noopener', text: 'Open in ClickUp' }),
    el('details', { className: 'menu' }, el('summary', { text: 'More' }),
      el('div', {}, el('button', { type: 'button', text: 'Keep agents away from this task', onclick: () => send(item, 'block', undefined, box, result) }))));

  if (item.needs === 'decision' && item.proposedTask) {
    parts.push(el('div', { className: 'proposal' }, el('p', { className: 'section-label', text: 'Why the analysis proposes it' }), el('p', {}, ...inline(item.proposedTask))));
    parts.push(el('div', { className: 'actions' },
      el('div', { className: 'main' },
        el('button', { type: 'button', className: 'btn primary', text: 'Accept the task', onclick: () => send(item, 'accept-task', undefined, box, result) }),
        el('button', { type: 'button', className: 'btn', text: 'Reject', onclick: () => send(item, 'reject-task', undefined, box, result) })),
      side));
    parts.push(el('p', { className: 'after', text: 'Accept the task lets agents take it at the next check. Reject closes it. Open it in ClickUp first to read or change its description.' }));
  } else if (item.needs === 'review' && item.readyToClose) {
    parts.push(el('div', { className: 'proposal' }, el('p', { className: 'section-label', text: 'Ready to close' }), el('p', {}, ...inline(item.readyToClose))));
    const text = field('What should change', 'What should the agent fix? It reads this and continues on the same branch.');
    const feedback = el('div', { hidden: true }, el('p', { className: 'section-label', text: 'What should change' }), text,
      el('div', { className: 'actions' }, el('div', { className: 'main' },
        el('button', { type: 'button', className: 'btn primary', text: 'Send to the agent', onclick: () => (text.value.trim() ? send(item, 'send-back', text.value, box, result) : text.focus()) }),
        el('button', { type: 'button', className: 'quiet', text: 'Cancel', onclick: () => { feedback.hidden = true; } }))));
    parts.push(el('div', { className: 'actions' },
      el('div', { className: 'main' },
        el('button', { type: 'button', className: 'btn primary', text: 'Close the task', onclick: () => send(item, 'close', undefined, box, result) }),
        el('button', { type: 'button', className: 'btn', text: 'Request changes', onclick: () => { feedback.hidden = false; text.focus(); } })),
      side));
    parts.push(feedback);
    parts.push(el('p', { className: 'after', text: 'The analysis verified every criterion. Close the task moves it to the closed status of its list. Request changes sends your note back to the agent.' }));
  } else if (item.needs === 'decision') {
    if (item.questions.length) parts.push(el('div', {}, el('p', { className: 'section-label', text: 'The agent asks' }), el('ol', { className: 'numbered decision' }, item.questions.map((q) => el('li', {}, el('span', {}, ...inline(q)))))));
    else if (note) parts.push(note);
    if (item.proposal) parts.push(el('div', { className: 'proposal' }, el('p', { className: 'section-label', text: 'The agent proposes' }), el('p', {}, ...inline(item.proposal))));
    const answer = field('Your answer', 'Answer the questions in your words. The agent reads it and continues.');
    parts.push(el('div', {}, el('p', { className: 'section-label', text: 'Your answer' }), answer));
    parts.push(el('div', { className: 'actions' },
      el('div', { className: 'main' },
        el('button', { type: 'button', className: 'btn primary', text: 'Send answer', onclick: () => (answer.value.trim() ? send(item, 'answer', answer.value, box, result) : answer.focus()) }),
        item.proposal ? el('button', { type: 'button', className: 'btn', text: 'Accept the proposal', onclick: () => send(item, 'accept-proposal', undefined, box, result) }) : null),
      side));
    parts.push(el('p', { className: 'after', text: 'After you answer, the task leaves your queue and an agent takes it up at the next check.' }));
  } else {
    if (item.needs === 'test' && item.checked.length) parts.push(el('div', {}, el('p', { className: 'section-label', text: 'Already checked by the agents' }), el('ul', { className: 'checked' }, item.checked.map((c) => el('li', {}, ...inline(c))))));
    if (item.needs === 'test' && item.byHand.length) parts.push(el('div', {}, el('p', { className: 'section-label', text: 'What only you can check' }), el('ol', { className: 'numbered test' }, item.byHand.map((s) => el('li', {}, el('span', {}, ...inline(s)))))));
    else if (note) parts.push(note);
    const ok = item.needs === 'test' ? 'It works' : 'Approve';
    const wrong = item.needs === 'test' ? 'Something is wrong' : 'Request changes';
    const text = field('What should change', 'What should the agent fix? It reads this and continues on the same branch.');
    const feedback = el('div', { hidden: true }, el('p', { className: 'section-label', text: 'What should change' }), text,
      el('div', { className: 'actions' }, el('div', { className: 'main' },
        el('button', { type: 'button', className: 'btn primary', text: 'Send to the agent', onclick: () => (text.value.trim() ? send(item, 'send-back', text.value, box, result) : text.focus()) }),
        el('button', { type: 'button', className: 'quiet', text: 'Cancel', onclick: () => { feedback.hidden = true; } }))));
    parts.push(el('div', { className: 'actions' },
      el('div', { className: 'main' },
        el('button', { type: 'button', className: 'btn primary', text: ok, onclick: () => send(item, 'approve', undefined, box, result) }),
        el('button', { type: 'button', className: 'btn', text: wrong, onclick: () => { feedback.hidden = false; text.focus(); } })),
      side));
    parts.push(feedback);
    // Only when the orchestrator will merge it: a run that failed its checks stays the person's to merge.
    const merges = item.autoMerge;
    let after = ok + ' takes the task out of your queue; ' + (item.needs === 'test' ? 'merging the branch stays with you. ' : 'merging and closing it stay with you. ');
    if (merges) after = ok + ' lets the orchestrator merge ' + (item.needs === 'test' ? 'the branch' : 'it') + ' once its checks pass; closing it stays with you. ';
    parts.push(el('p', { className: 'after', text: after + wrong + ' sends your note back to the agent.' }));
  }
  parts.push(result);
  box.replaceChildren(...parts);
}

function renderHistory(state) {
  const days = new Map();
  for (const run of state.history.slice(0, 30)) {
    const day = new Date(run.finishedAt).toDateString();
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(run);
  }
  const today = new Date(state.generatedAt).toDateString();
  const outcome = (run) => {
    if (run.needs === 'decision') return 'Waiting for your decision.';
    if (run.needs === 'test') return 'Waiting for your check by hand.';
    if (run.needs === 'review' && run.verdict === 'pass') return 'Ready for your review, every criterion verified.';
    if (run.needs === 'review') return 'Waiting for your review.';
    return 'Finished.';
  };
  const box = document.getElementById('history');
  box.replaceChildren(...[...days].flatMap(([day, runs]) => [
    el('p', { className: 'day', text: day === today ? 'Today' : new Date(runs[0].finishedAt).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }) }),
    el('ol', { className: 'timeline' }, runs.map((run) => el('li', { 'data-needs': run.needs || '' },
      el('time', { dateTime: run.finishedAt, text: clock(run.finishedAt) }),
      el('a', { href: run.url, target: '_blank', rel: 'noopener', text: run.name }),
      el('p', { text: run.projectName + '. ' + outcome(run) + (run.tests === 'fail' ? ' Tests failed.' : '') + (run.costUsd === null ? '' : ' ' + run.costUsd.toFixed(2) + ' USD.') })))),
  ]));
  if (!days.size) box.replaceChildren(el('p', { className: 'muted', text: 'No agent has finished a task yet.' }));
}

function render(state) {
  ui.state = state;
  renderControl(state);
  renderSync(state);
  renderProjects(state);
  renderQueue(state);
  renderDetail(state);
  renderHistory(state);
}

async function post(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-action-token': TOKEN }, body: JSON.stringify(body) });
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(answer.error || 'The orchestrator answered ' + response.status + '.');
  return answer;
}

async function send(item, action, text, box, result) {
  for (const control of box.querySelectorAll('button, textarea')) control.disabled = true;
  result.className = 'result';
  result.textContent = 'Sending.';
  try {
    await post('/api/action', { project: item.project, task: item.id, action, text });
    result.textContent = DONE[action];
    setTimeout(() => refresh(true), 1500);
  } catch (error) {
    result.className = 'result failed';
    result.textContent = error.message;
    for (const control of box.querySelectorAll('button, textarea')) control.disabled = false;
  }
}

async function switchMode(action, button) {
  button.disabled = true;
  try {
    await post('/api/control', { action });
  } catch (error) {
    document.getElementById('state-hint').textContent = error.message;
  }
  refresh(true);
}

// Someone is typing, waiting for an answer or choosing in a menu: a refresh would throw that away.
function busy() {
  return [...document.querySelectorAll('textarea')].some((area) => area.value.trim() !== '')
    || Boolean(document.querySelector('#detail button:disabled'))
    || Boolean(document.querySelector('details.menu[open]'))
    || Boolean(document.querySelector('.place-form'))
    || Boolean(document.querySelector('dialog[open]'));
}

// A More menu closes like a menu: a click outside it, choosing an item, Escape or opening another menu.
function closeMenus(except) {
  for (const menu of document.querySelectorAll('details.menu[open]')) if (menu !== except) menu.open = false;
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('details.menu') || event.target.closest('details.menu div button')) closeMenus();
});

document.addEventListener('keydown', (event) => {
  const menu = document.querySelector('details.menu[open]');
  if (event.key === 'Escape' && menu) {
    menu.open = false;
    menu.querySelector('summary').focus();
  }
});

// The toggle event does not bubble, so it is caught on the way down.
document.addEventListener('toggle', (event) => {
  if (event.target.matches('details.menu') && event.target.open) closeMenus(event.target);
}, true);

let timer = null;

// The next look at the state: soon while the orchestrator reads the task system, otherwise every 30 seconds.
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => refresh(false), ui.state && ui.state.sync.reading ? READING_MS : REFRESH_MS);
}

async function refresh(force) {
  try {
    if (force || !busy()) {
      const response = await fetch('/api/state', { cache: 'no-store' });
      if (response.ok) render(await response.json());
    }
  } catch {
    // The orchestrator is stopped or restarting: keep showing the last state.
  }
  schedule();
}

document.getElementById('refresh').onclick = async () => {
  const button = document.getElementById('refresh');
  button.disabled = true;
  try {
    await post('/api/refresh', {});
  } catch (error) {
    document.getElementById('sync-text').textContent = error.message;
    document.getElementById('sync').hidden = false;
  }
  refresh(true);
};

render(JSON.parse(document.getElementById('initial-state').textContent));
schedule();
`;
