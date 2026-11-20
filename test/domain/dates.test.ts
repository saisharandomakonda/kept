import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatDate,
  formatDateWithDay,
  isIsoDate,
  maxDate,
  minDate,
  plural,
  relativeDays,
  toIsoDate,
} from '../../src/domain/dates';

describe('dates', () => {
  it('validates calendar dates', () => {
    expect(isIsoDate('2026-12-10')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-12-1')).toBe(false);
    expect(isIsoDate(20261210)).toBe(false);
  });

  it('converts timestamps and dates to calendar dates', () => {
    expect(toIsoDate('2026-12-10T23:59:00.000+0530')).toBe('2026-12-10');
    expect(toIsoDate(new Date(Date.UTC(2026, 11, 10)))).toBe('2026-12-10');
    expect(toIsoDate(undefined)).toBeUndefined();
    expect(toIsoDate('garbage')).toBeUndefined();
    expect(toIsoDate(new Date('nope'))).toBeUndefined();
  });

  it('counts days across months and years', () => {
    expect(daysBetween('2026-12-01', '2026-12-10')).toBe(9);
    expect(daysBetween('2026-12-10', '2026-12-01')).toBe(-9);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(addDays('2026-12-30', 5)).toBe('2027-01-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('picks min and max dates, ignoring blanks', () => {
    expect(maxDate('2026-12-01', undefined, '2026-12-09')).toBe('2026-12-09');
    expect(minDate(undefined, '2026-12-05', '2026-12-02')).toBe('2026-12-02');
    expect(maxDate()).toBeUndefined();
  });

  it('formats dates the way Jira does', () => {
    expect(formatDate('2026-12-10')).toBe('Dec 10');
    expect(formatDate('2027-01-04', '2026-12-01')).toBe('Jan 4, 2027');
    expect(formatDateWithDay('2026-12-10')).toBe('Thu, Dec 10');
  });

  it('describes relative days', () => {
    expect(relativeDays(0)).toBe('today');
    expect(relativeDays(1)).toBe('tomorrow');
    expect(relativeDays(-1)).toBe('yesterday');
    expect(relativeDays(5)).toBe('in 5 days');
    expect(relativeDays(-3)).toBe('3 days ago');
    expect(plural(1, 'day')).toBe('1 day');
    expect(plural(2, 'day')).toBe('2 days');
  });
});
