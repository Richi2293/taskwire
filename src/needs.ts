// Why a task waits for a person. Each kind is a tag on the task; removing it is the person's go-ahead.
export const NEEDS_KINDS = ['decision', 'test', 'review'] as const;
export type NeedsKind = (typeof NEEDS_KINDS)[number];

export type NeedsTags = Record<NeedsKind, string>;

export const DEFAULT_NEEDS_TAGS: NeedsTags = {
  decision: 'needs-decision',
  test: 'needs-test',
  review: 'needs-review',
};

export function isNeedsKind(value: string): value is NeedsKind {
  return NEEDS_KINDS.some((kind) => kind === value);
}

// The first kind whose tag the task has; a task is meant to carry at most one.
export function needsFromTags(tags: string[], names: NeedsTags): NeedsKind | null {
  return NEEDS_KINDS.find((kind) => tags.includes(names[kind])) ?? null;
}
