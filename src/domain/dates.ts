// Calendar-date helpers. Dates are plain YYYY-MM-DD strings handled in UTC so results never
// shift with the server's time zone.
import type { IsoDate } from './types';

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Accepts YYYY-MM-DD or a full ISO timestamp and returns the calendar date part. */
export function toIsoDate(value: string | Date | undefined | null): IsoDate | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  const head = value.slice(0, 10);
  return isIsoDate(head) ? head : undefined;
}

function toUtc(date: IsoDate): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

/** b − a in whole days. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

export function maxDate(...dates: (IsoDate | undefined)[]): IsoDate | undefined {
  return dates.filter((d): d is IsoDate => !!d).sort().at(-1);
}

export function minDate(...dates: (IsoDate | undefined)[]): IsoDate | undefined {
  return dates.filter((d): d is IsoDate => !!d).sort()[0];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Dec 10" (adds the year when it differs from the reference year). */
export function formatDate(date: IsoDate, reference?: IsoDate): string {
  const d = new Date(toUtc(date));
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  if (reference && reference.slice(0, 4) !== date.slice(0, 4)) return `${base}, ${d.getUTCFullYear()}`;
  return base;
}

/** "Thu, Dec 10" */
export function formatDateWithDay(date: IsoDate, reference?: IsoDate): string {
  const d = new Date(toUtc(date));
  return `${WEEKDAYS[d.getUTCDay()]}, ${formatDate(date, reference)}`;
}

/** "in 3 days", "today", "tomorrow", "2 days ago". */
export function relativeDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days > 0) return `in ${days} days`;
  return `${-days} days ago`;
}

export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
