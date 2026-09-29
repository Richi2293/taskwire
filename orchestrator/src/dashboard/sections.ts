// The fixed sections of a comment written for a person (see rules/tasks.md): their headings stay in English
// in every project language, so they can be found here.
export interface Sections {
  questions: string[];
  proposal: string | null;
  checked: string[];
  byHand: string[];
  // Written by the project analysis: why it proposes a new task, and why a task waiting for a person can be closed.
  proposedTask: string | null;
  readyToClose: string | null;
}

const HEADINGS: Record<string, keyof Sections> = {
  questions: 'questions',
  proposal: 'proposal',
  checked: 'checked',
  'by hand': 'byHand',
  'proposed task': 'proposedTask',
  'ready to close': 'readyToClose',
};

export function readSections(markdown: string): Sections {
  const found: Record<string, string[]> = {};
  let current: string | null = null;
  for (const line of markdown.split('\n')) {
    const heading = /^#{2,4}\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      current = HEADINGS[heading[1].toLowerCase()] ?? null;
      if (current !== null) found[current] = [];
      continue;
    }
    if (current !== null && line.trim() !== '') found[current].push(line.trim());
  }
  const items = (key: string) => (found[key] ?? []).map((line) => line.replace(/^(?:\d+[.)]|[-*])\s+/, ''));
  const paragraph = (key: string) => (found[key] ?? []).join(' ').trim() || null;
  return {
    questions: items('questions'),
    proposal: paragraph('proposal'),
    checked: items('checked'),
    byHand: items('byHand'),
    proposedTask: paragraph('proposedTask'),
    readyToClose: paragraph('readyToClose'),
  };
}

// A description opens with a quote for people ("> **Goal:** ..."): its first line, without the label, is the goal.
export function goalFrom(description: string): string | null {
  const first = description.split('\n').find((line) => line.startsWith('>') && line.replace(/^>\s*/, '').trim() !== '');
  if (first === undefined) return null;
  return first.replace(/^>\s*/, '').replace(/^\*\*[^*]+:\*\*\s*/, '').trim() || null;
}
