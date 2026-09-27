// The fixed sections of a comment written for a person (see rules/tasks.md): their headings stay in English
// in every project language, so they can be found here.
export interface Sections {
  questions: string[];
  proposal: string | null;
  checked: string[];
  byHand: string[];
}

const HEADINGS: Record<string, keyof Sections> = {
  questions: 'questions',
  proposal: 'proposal',
  checked: 'checked',
  'by hand': 'byHand',
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
  const proposal = (found.proposal ?? []).join(' ').trim();
  return { questions: items('questions'), proposal: proposal === '' ? null : proposal, checked: items('checked'), byHand: items('byHand') };
}

// A description opens with a quote for people ("> **Goal:** ..."): its first line, without the label, is the goal.
export function goalFrom(description: string): string | null {
  const first = description.split('\n').find((line) => line.startsWith('>') && line.replace(/^>\s*/, '').trim() !== '');
  if (first === undefined) return null;
  return first.replace(/^>\s*/, '').replace(/^\*\*[^*]+:\*\*\s*/, '').trim() || null;
}
