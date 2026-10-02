// The area of a project in a task list shared by several projects: a task tag, one word, lowercase like every tag.
const AREA = /^[a-z0-9][a-z0-9_-]{0,29}$/;

export const AREA_HINT = 'Use one word, a tag such as "be", "fe" or "mobile"';

// Null when the value cannot be an area.
export function normalizeArea(value: string): string | null {
  const tag = value.trim().toLowerCase();
  return AREA.test(tag) ? tag : null;
}
