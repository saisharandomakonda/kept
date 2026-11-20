// Turns Jira changelog items into short human sentences ("moved from Sprint 14 to Sprint 15").
// Only fields that can move a fix date are kept.
import { formatDate, toIsoDate } from './dates';
import type { Evidence } from './types';

/** A Jira changelog item: field, fieldId, from, fromString, to, toString (any may be missing). */
export type ChangelogItem = Readonly<Record<string, unknown>>;

export type TrackedField = 'sprint' | 'fixVersions' | 'status' | 'priority' | 'duedate' | 'resolution' | 'assignee';

export interface FieldChange {
  field: TrackedField;
  from: string | null;
  to: string | null;
  fromLabel: string | null;
  toLabel: string | null;
}

function ownString(item: ChangelogItem, key: string): string | null {
  // Own string values only: a missing "toString" key would otherwise resolve to Object.prototype.toString.
  const v = Object.prototype.hasOwnProperty.call(item, key) ? item[key] : null;
  return typeof v === 'string' ? v : null;
}

function classify(item: ChangelogItem): TrackedField | undefined {
  const id = (ownString(item, 'fieldId') ?? '').toLowerCase();
  const name = (ownString(item, 'field') ?? '').toLowerCase();
  if (name === 'sprint') return 'sprint';
  if (id === 'fixversions' || name === 'fix version' || name === 'fix versions') return 'fixVersions';
  if (id === 'status' || name === 'status') return 'status';
  if (id === 'priority' || name === 'priority') return 'priority';
  if (id === 'duedate' || name === 'duedate' || name === 'due date') return 'duedate';
  if (id === 'resolution' || name === 'resolution') return 'resolution';
  if (id === 'assignee' || name === 'assignee') return 'assignee';
  return undefined;
}

export function relevantChanges(items: readonly ChangelogItem[] | undefined): FieldChange[] {
  const out: FieldChange[] = [];
  for (const item of items ?? []) {
    const field = classify(item);
    if (!field) continue;
    const own = (key: string) => ownString(item, key);
    out.push({ field, from: own('from'), to: own('to'), fromLabel: own('fromString'), toLabel: own('toString') });
  }
  return out;
}

/** Sprint changelog values are comma-separated sprint ids ("4, 5"). Returns the ids that were added. */
export function addedSprintIds(change: FieldChange): number[] {
  const parse = (v: string | null) =>
    (v ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  const before = new Set(parse(change.from));
  return parse(change.to).filter((id) => !before.has(id));
}

export function removedSprintIds(change: FieldChange): number[] {
  const parse = (v: string | null) =>
    (v ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  const after = new Set(parse(change.to));
  return parse(change.from).filter((id) => !after.has(id));
}

/**
 * One sentence per change, e.g. "Moved from Sprint 14 to Sprint 15".
 * `names` maps raw ids (sprint ids) to display names when the changelog doesn't carry them.
 */
export function describeChange(change: FieldChange, names: Record<string, string> = {}): string | undefined {
  const label = (raw: string | null, text: string | null) => text ?? (raw ? names[raw] ?? raw : null);
  switch (change.field) {
    case 'sprint': {
      const removed = removedSprintIds(change).map((id) => names[String(id)] ?? `sprint ${id}`);
      const added = addedSprintIds(change).map((id) => names[String(id)] ?? `sprint ${id}`);
      if (removed.length && added.length) return `Moved from ${removed.join(', ')} to ${added.join(', ')}`;
      if (added.length) return `Added to ${added.join(', ')}`;
      if (removed.length) return `Removed from ${removed.join(', ')} (back to the backlog)`;
      return undefined;
    }
    case 'fixVersions': {
      const from = label(change.from, change.fromLabel);
      const to = label(change.to, change.toLabel);
      if (from && to) return `Release changed from ${from} to ${to}`;
      if (to) return `Added to release ${to}`;
      if (from) return `Removed from release ${from}`;
      return undefined;
    }
    case 'status':
      return `Status changed from ${change.fromLabel ?? change.from ?? '?'} to ${change.toLabel ?? change.to ?? '?'}`;
    case 'priority':
      return `Priority changed from ${change.fromLabel ?? '?'} to ${change.toLabel ?? '?'}`;
    case 'duedate': {
      const from = toIsoDate(change.from ?? change.fromLabel ?? undefined);
      const to = toIsoDate(change.to ?? change.toLabel ?? undefined);
      if (from && to) return `Due date changed from ${formatDate(from)} to ${formatDate(to)}`;
      if (to) return `Due date set to ${formatDate(to)}`;
      if (from) return `Due date removed (was ${formatDate(from)})`;
      return undefined;
    }
    case 'resolution':
      return change.toLabel ? `Resolved as ${change.toLabel}` : 'Reopened';
    case 'assignee':
      return change.to ? `Assigned to ${change.toLabel ?? 'someone new'}` : 'Unassigned';
  }
}

export function toEvidence(change: FieldChange, by: string | null, at: string | null, names: Record<string, string> = {}): Evidence & { text: string } {
  return {
    field: change.field,
    from: change.fromLabel ?? change.from,
    to: change.toLabel ?? change.to,
    by,
    at,
    text: describeChange(change, names) ?? `${change.field} changed`,
  };
}
