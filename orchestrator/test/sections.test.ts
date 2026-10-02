import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalFrom, readSections } from '../src/dashboard/sections.ts';

const decision = `> **Stato:** non iniziato, servono decisioni prima di scrivere codice.
> **Prossimo:** rispondere alle domande.

---

### Questions

1. Convertire i prezzi con un tasso di cambio, o cambiare solo il simbolo?
2. Quali valute supportare oltre all'euro?

### Proposal

Cambiare solo il simbolo, con EUR, USD e GBP.
Circa mezz'ora di lavoro.

### Details

- **Branch:** nessuno`;

const tryIt = `> **Fatto:** listino reso responsive.

---

### Checked

- \`npm test\` passa, 4 test su 4
- Nessun testo tagliato a 360 px

### By hand

1. Apri \`index.html\` sul telefono.
2. Controlla che i prezzi siano allineati.

### Details

- **Branch:** \`feat/mobile-price-list\``;

test('reads the questions and the proposal of a decision', () => {
  assert.deepEqual(readSections(decision), {
    questions: ['Convertire i prezzi con un tasso di cambio, o cambiare solo il simbolo?', "Quali valute supportare oltre all'euro?"],
    proposal: "Cambiare solo il simbolo, con EUR, USD e GBP. Circa mezz'ora di lavoro.",
    checked: [],
    byHand: [],
    proposedTask: null,
    readyToClose: null,
  });
});

test('reads what was checked and the steps by hand of a test', () => {
  assert.deepEqual(readSections(tryIt), {
    questions: [],
    proposal: null,
    checked: ['`npm test` passa, 4 test su 4', 'Nessun testo tagliato a 360 px'],
    byHand: ['Apri `index.html` sul telefono.', 'Controlla che i prezzi siano allineati.'],
    proposedTask: null,
    readyToClose: null,
  });
});

test('a comment without the sections gives nothing, and headings are matched ignoring case', () => {
  assert.deepEqual(readSections('> **Fatto:** tutto.\n\n---\n\n### Details\n\n- x'), { questions: [], proposal: null, checked: [], byHand: [], proposedTask: null, readyToClose: null });
  assert.deepEqual(readSections('### questions\n\n1. Sure?').questions, ['Sure?']);
});

test('the goal is the first line of the description quote, without its label', () => {
  assert.equal(goalFrom('> **Obiettivo:** mostrare i prezzi nella valuta del cliente.  \n>   \n> **Perché:** alcuni clienti non pagano in euro.'), 'mostrare i prezzi nella valuta del cliente.');
  assert.equal(goalFrom('> Just a quote line.'), 'Just a quote line.');
  assert.equal(goalFrom('No quote at all.'), null);
});

test('reads why the analysis proposes a new task, and why a task is ready to close', () => {
  const proposed = '> **Stato:** proposto dall\'analisi.\n\n---\n\n### Proposed task\n\nIl modulo dei pagamenti non ha test.\nUn errore lì costa caro.\n\n### Details\n\n- x';
  assert.equal(readSections(proposed).proposedTask, 'Il modulo dei pagamenti non ha test. Un errore lì costa caro.');
  const ready = '> **Fatto:** verificato.\n\n---\n\n### Ready to close\n\nTutti i criteri verificati, PR #12 mergiata in `dev`.';
  assert.equal(readSections(ready).readyToClose, 'Tutti i criteri verificati, PR #12 mergiata in `dev`.');
});
