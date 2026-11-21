import { describe, expect, it } from 'vitest';
import {
  addedSprintIds,
  describeChange,
  relevantChanges,
  removedSprintIds,
  toEvidence,
} from '../../src/domain/changes';
import { draftCustomerUpdate, looksInternal } from '../../src/domain/draft';
import { RISK_STYLE, riskLabel } from '../../src/domain/labels';
import { portalView } from '../../src/domain/portal';
import { TODAY, dev, sprint, version } from '../fixtures/dev';

const base = { topic: 'Invoice export fails for large accounts.', promisedDate: '2026-12-10', today: TODAY };

describe('draftCustomerUpdate', () => {
  it('re-promises honestly with a new date', () => {
    const text = draftCustomerUpdate({ ...base, risk: 'at-risk', newDate: '2026-12-17', customerName: 'Sam Lee', agentName: 'Maya Chen' });
    expect(text).toContain('Hi Sam,');
    expect(text).toContain('"Invoice export fails for large accounts"');
    expect(text).toContain("by Thu, Dec 10, and I'm no longer confident we'll make that date");
    expect(text).toContain('now expected by Thu, Dec 17');
    expect(text.trim().endsWith('Maya')).toBe(true);
    expect(looksInternal(text)).toBe(false);
  });

  it('commits to a check-in date when there is no new date', () => {
    const text = draftCustomerUpdate({ ...base, risk: 'unplanned' });
    expect(text).toContain('Hi there,');
    expect(text).toContain("don't have a confirmed new date yet");
    expect(text).toContain('by Fri, Dec 4 at the latest');
    expect(text.trim().endsWith('Thanks for your patience.')).toBe(true);
  });

  it('apologises when the date has passed', () => {
    expect(draftCustomerUpdate({ ...base, risk: 'broken', newDate: '2026-12-17' })).toContain("we've missed that date. I'm sorry.");
  });

  it('shares good news when delivered', () => {
    const text = draftCustomerUpdate({ ...base, risk: 'delivered', deliveredAt: '2026-11-30', agentName: 'Maya' });
    expect(text).toContain('was released on Mon, Nov 30');
    expect(text).toContain('Thanks again for reporting this,\nMaya');
  });

  it('confirms when on track', () => {
    const text = draftCustomerUpdate({ ...base, risk: 'on-track', topic: '' });
    expect(text).toContain('A quick update on your request: the fix is still on track for Thu, Dec 10.');
  });

  it('never leaks internal details in any situation', () => {
    for (const risk of ['on-track', 'tight', 'at-risk', 'broken', 'unplanned', 'delivered', 'unknown'] as const) {
      expect(looksInternal(draftCustomerUpdate({ ...base, risk, newDate: '2026-12-20' }))).toBe(false);
    }
  });

  it('spots internal details', () => {
    expect(looksInternal('Moved to Sprint 15')).toBe(true);
    expect(looksInternal('See BUG-12')).toBe(true);
    expect(looksInternal('It is in the backlog')).toBe(true);
    expect(looksInternal('The fix is on the way')).toBe(false);
  });
});

describe('portalView', () => {
  it('is hidden without linked work', () => {
    expect(portalView([], TODAY, true)).toBeNull();
  });

  it('maps status to customer stages', () => {
    expect(portalView([dev({ statusCategory: 'new' })], TODAY, false)).toMatchObject({ stageIndex: 1, stage: 'Confirmed' });
    expect(portalView([dev()], TODAY, false)).toMatchObject({ stageIndex: 2, stage: 'In development' });
    expect(portalView([dev({ statusCategory: 'done', fixVersions: [version('2.4', '2026-12-10')] })], TODAY, false)).toMatchObject({
      stageIndex: 3,
      stage: 'Fixed',
    });
    expect(portalView([dev({ statusCategory: 'done', resolutionDate: '2026-11-30' })], TODAY, false)).toMatchObject({
      stageIndex: 4,
      stage: 'Released',
    });
  });

  it('shows the planned date only when allowed', () => {
    const d = [dev({ sprints: [sprint('Sprint 15', '2026-12-17')] })];
    expect(portalView(d, TODAY, false)?.plannedDate).toBeUndefined();
    expect(portalView(d, TODAY, true)?.plannedDate).toBe('2026-12-17');
  });

  it('uses the slowest work item and the latest date', () => {
    const v = portalView(
      [dev({ statusCategory: 'done', resolutionDate: '2026-11-30' }), dev({ key: 'BUG-13', dueDate: '2026-12-12' })],
      TODAY,
      true
    );
    expect(v?.stage).toBe('In development');
    expect(v?.plannedDate).toBe('2026-12-12');
  });

  it('hides the date when any part is unplanned', () => {
    expect(portalView([dev({ dueDate: '2026-12-12' }), dev({ key: 'BUG-13' })], TODAY, true)?.plannedDate).toBeUndefined();
  });

  it('only ever exposes safe fields', () => {
    const v = portalView([dev({ sprints: [sprint('Sprint 15', '2026-12-17')], assigneeName: 'Dev Patel' })], TODAY, true);
    expect(Object.keys(v ?? {}).sort()).toEqual(['message', 'plannedDate', 'stage', 'stageIndex']);
    expect(JSON.stringify(v)).not.toMatch(/BUG-12|Sprint|Dev Patel/);
  });
});

describe('changes', () => {
  const items = [
    { field: 'Sprint', fieldId: 'customfield_10020', from: '14', to: '15', fromString: null, toString: null },
    { field: 'Fix Version', fieldId: 'fixVersions', from: '10001', fromString: '2.4', to: null, toString: null },
    { field: 'status', fieldId: 'status', from: '1', fromString: 'To Do', to: '3', toString: 'In Progress' },
    { field: 'summary', fieldId: 'summary', from: null, fromString: 'a', to: null, toString: 'b' },
    { field: 'duedate', fieldId: 'duedate', from: '2026-12-08', to: '2026-12-15', fromString: '2026-12-08 00:00:00.0', toString: '2026-12-15 00:00:00.0' },
  ];

  it('keeps only fields that move a fix date', () => {
    expect(relevantChanges(items).map((c) => c.field)).toEqual(['sprint', 'fixVersions', 'status', 'duedate']);
    expect(relevantChanges(undefined)).toEqual([]);
  });

  it('describes sprint moves with names', () => {
    const [s] = relevantChanges(items);
    expect(describeChange(s!, { 14: 'Sprint 14', 15: 'Sprint 15' })).toBe('Moved from Sprint 14 to Sprint 15');
    expect(describeChange(s!)).toBe('Moved from sprint 14 to sprint 15');
  });

  it('handles multi-sprint values', () => {
    const c = relevantChanges([{ field: 'Sprint', from: '13, 14', to: '13, 14, 15' }])[0]!;
    expect(addedSprintIds(c)).toEqual([15]);
    expect(removedSprintIds(c)).toEqual([]);
    expect(describeChange(c, { 15: 'Sprint 15' })).toBe('Added to Sprint 15');
    const back = relevantChanges([{ field: 'Sprint', from: '14', to: '' }])[0]!;
    expect(describeChange(back, { 14: 'Sprint 14' })).toBe('Removed from Sprint 14 (back to the backlog)');
    expect(describeChange(relevantChanges([{ field: 'Sprint', from: '', to: '' }])[0]!)).toBeUndefined();
  });

  it('describes the other fields', () => {
    const all = relevantChanges([
      ...items,
      { field: 'Fix Version', fieldId: 'fixVersions', from: null, to: '10002', toString: '2.5' },
      { field: 'priority', fieldId: 'priority', fromString: 'High', toString: 'Low' },
      { field: 'resolution', fieldId: 'resolution', toString: 'Done' },
      { field: 'resolution', fieldId: 'resolution', fromString: 'Done', toString: null },
      { field: 'assignee', fieldId: 'assignee', to: 'abc', toString: 'Dev Patel' },
      { field: 'assignee', fieldId: 'assignee', from: 'abc', to: null },
      { field: 'duedate', fieldId: 'duedate', from: null, to: '2026-12-15' },
      { field: 'duedate', fieldId: 'duedate', from: '2026-12-15', to: null },
    ]).map((c) => describeChange(c));
    expect(all).toEqual([
      'Moved from sprint 14 to sprint 15',
      'Removed from release 2.4',
      'Status changed from To Do to In Progress',
      'Due date changed from Dec 8 to Dec 15',
      'Added to release 2.5',
      'Priority changed from High to Low',
      'Resolved as Done',
      'Reopened',
      'Assigned to Dev Patel',
      'Unassigned',
      'Due date set to Dec 15',
      'Due date removed (was Dec 15)',
    ]);
  });

  it('builds evidence with who and when', () => {
    const [s] = relevantChanges(items);
    expect(toEvidence(s!, 'Dev Patel', '2026-12-03T10:00:00Z', { 14: 'Sprint 14', 15: 'Sprint 15' })).toMatchObject({
      field: 'sprint',
      by: 'Dev Patel',
      text: 'Moved from Sprint 14 to Sprint 15',
    });
  });
});

describe('labels', () => {
  it('covers every risk with an ADS appearance', () => {
    expect(RISK_STYLE['at-risk']).toMatchObject({ label: 'At risk', appearance: 'removed', bold: true });
    expect(riskLabel(undefined)).toBe('No promises');
    expect(riskLabel('delivered')).toBe('Delivered');
  });
});
