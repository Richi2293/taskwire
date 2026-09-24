import { usageError } from './errors.ts';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function msToIso(ms: string | number | null | undefined): string | null {
  const date = parseMs(ms);
  return date === null ? null : date.toISOString();
}

// Due dates are days picked by a person, so they read best in the system time zone, with its offset.
export function msToLocalIso(ms: string | number | null | undefined): string | null {
  const date = parseMs(ms);
  if (date === null) return null;
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${day}T${time}${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

function parseMs(ms: string | number | null | undefined): Date | null {
  if (ms === null || ms === undefined || ms === '') return null;
  const value = Number(ms);
  return Number.isFinite(value) ? new Date(value) : null;
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
