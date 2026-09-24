import { usageError } from './errors.ts';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function msToIso(ms: string | number | null | undefined): string | null {
  if (ms === null || ms === undefined || ms === '') return null;
  const value = Number(ms);
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

// Midnight of the given day in the system time zone (the TZ environment variable, or the OS setting).
export function localMidnightMs(date: string): number {
  const match = DATE_PATTERN.exec(date);
  if (!match) throw usageError(`Invalid date "${date}"`, 'Use the YYYY-MM-DD format');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const midnight = new Date(year, month - 1, day);
  if (midnight.getFullYear() !== year || midnight.getMonth() !== month - 1 || midnight.getDate() !== day) {
    throw usageError(`Invalid date "${date}"`, 'The day does not exist');
  }
  return midnight.getTime();
}
