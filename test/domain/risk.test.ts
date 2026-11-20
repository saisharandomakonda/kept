import { describe, expect, it } from 'vitest';
import { assess, isWorse, worstRisk } from '../../src/domain/risk';
import { DEFAULT_SETTINGS } from '../../src/domain/types';
import { TODAY, dev, sprint, version } from '../fixtures/dev';

const promise = (promisedDate: string) => ({ promisedDate });

describe('assess', () => {
  it('is unknown when no dev work item is linked', () => {
    const a = assess(promise('2026-12-10'), undefined, TODAY);
    expect(a.risk).toBe('unknown');
    expect(a.reasons[0]?.code).toBe('no-dev-item');
    expect(a.daysLeft).toBe(9);
  });

  it('is on track when the release ships well before the promise', () => {
    const a = assess(promise('2026-12-10'), dev({ fixVersions: [version('2.4', '2026-12-06')] }), TODAY);
    expect(a.risk).toBe('on-track');
    expect(a.gapDays).toBe(-4);
    expect(a.reasons[0]?.message).toBe('Release 2.4 ships Dec 6, 4 days before the promise (Dec 10).');
  });

  it('is tight when the plan lands inside the buffer', () => {
    const a = assess(promise('2026-12-10'), dev({ fixVersions: [version('2.4', '2026-12-09')] }), TODAY);
    expect(a.risk).toBe('tight');
    expect(a.reasons[0]?.message).toBe('Release 2.4 ships Dec 9, only 1 day before the promise (Dec 10).');
  });

  it('is tight when the plan lands on the promised day', () => {
    const a = assess(promise('2026-12-10'), dev({ sprints: [sprint('Sprint 14', '2026-12-10')] }), TODAY);
    expect(a.risk).toBe('tight');
    expect(a.reasons[0]?.message).toContain('the same day as the promise');
  });

  it('respects a custom buffer', () => {
    const d = dev({ fixVersions: [version('2.4', '2026-12-07')] });
    expect(assess(promise('2026-12-10'), d, TODAY, { ...DEFAULT_SETTINGS, bufferDays: 2 }).risk).toBe('on-track');
    expect(assess(promise('2026-12-10'), d, TODAY, { ...DEFAULT_SETTINGS, bufferDays: 5 }).risk).toBe('tight');
  });

  it('is at risk when the sprint ends after the promise (the demo moment)', () => {
    const a = assess(promise('2026-12-10'), dev({ sprints: [sprint('Sprint 15', '2026-12-17', 'future')] }), TODAY);
    expect(a.risk).toBe('at-risk');
    expect(a.gapDays).toBe(7);
    expect(a.reasons[0]?.message).toBe(
      'BUG-12 is in Sprint 15, which ends Dec 17, 7 days after the promised date (Dec 10).'
    );
  });

  it('is at risk when the release moves past the promise', () => {
    const a = assess(promise('2026-12-10'), dev({ fixVersions: [version('2.4', '2026-12-16')] }), TODAY);
    expect(a.risk).toBe('at-risk');
    expect(a.reasons[0]?.code).toBe('release-after-promise');
    expect(a.reasons[0]?.message).toBe('Release 2.4 is planned for Dec 16, 6 days after the promised date (Dec 10).');
  });

  it('is at risk when the due date is after the promise', () => {
    const a = assess(promise('2026-12-10'), dev({ dueDate: '2026-12-12' }), TODAY);
    expect(a.risk).toBe('at-risk');
    expect(a.reasons[0]?.code).toBe('due-after-promise');
  });

  it('is at risk when the sprint ends after the release and after the promise', () => {
    const a = assess(
      promise('2026-12-10'),
      dev({ fixVersions: [version('2.4', '2026-12-09')], sprints: [sprint('Sprint 15', '2026-12-17')] }),
      TODAY
    );
    expect(a.risk).toBe('at-risk');
    expect(a.reasons.map((r) => r.code)).toEqual(['sprint-after-promise', 'sprint-after-release']);
  });

  it('is at least tight when the sprint ends after the release but before the promise', () => {
    const a = assess(
      promise('2026-12-20'),
      dev({ fixVersions: [version('2.4', '2026-12-05')], sprints: [sprint('Sprint 14', '2026-12-08')] }),
      TODAY
    );
    expect(a.risk).toBe('tight');
    expect(a.reasons.map((r) => r.code)).toContain('sprint-after-release');
  });

  it('is at risk when work has not started and the promise is close', () => {
    const a = assess(
      promise('2026-12-03'),
      dev({ statusCategory: 'new', status: 'To Do', sprints: [sprint('Sprint 14', '2026-12-02')] }),
      TODAY
    );
    expect(a.risk).toBe('at-risk');
    expect(a.reasons[0]?.code).toBe('not-started-soon');
    expect(a.reasons[0]?.message).toContain('in 2 days');
  });

  it('does not flag unstarted work when the promise is far away', () => {
    const a = assess(
      promise('2026-12-20'),
      dev({ statusCategory: 'new', status: 'To Do', sprints: [sprint('Sprint 15', '2026-12-10')] }),
      TODAY
    );
    expect(a.risk).toBe('on-track');
  });

  it('is at risk when nothing is planned and the promise is soon', () => {
    const a = assess(promise('2026-12-07'), dev(), TODAY);
    expect(a.risk).toBe('at-risk');
    expect(a.reasons[0]?.message).toBe(
      'BUG-12 has no sprint, release or due date, but the customer was promised Dec 7 (in 6 days).'
    );
  });

  it('is only unplanned when nothing is planned and the promise is far away', () => {
    const a = assess(promise('2027-01-30'), dev(), TODAY);
    expect(a.risk).toBe('unplanned');
    expect(a.reasons[0]?.message).toContain("isn't planned yet");
  });

  it('explains a fixed item waiting for an undated release', () => {
    const soon = assess(promise('2026-12-05'), dev({ statusCategory: 'done', fixVersions: [version('2.4')] }), TODAY);
    expect(soon.risk).toBe('at-risk');
    expect(soon.reasons[0]?.message).toContain('waiting for release 2.4, which has no date yet');
    const later = assess(promise('2027-02-05'), dev({ statusCategory: 'done', fixVersions: [version('2.4')] }), TODAY);
    expect(later.risk).toBe('unplanned');
    expect(later.reasons[0]?.message).toContain('waiting for release 2.4');
  });

  it('is broken when the promised date passed without delivery', () => {
    const a = assess(promise('2026-11-28'), dev({ sprints: [sprint('Sprint 14', '2026-12-08')] }), TODAY);
    expect(a.risk).toBe('broken');
    expect(a.reasons[0]?.message).toBe(
      "The promised date (Nov 28) passed 3 days ago and the fix hasn't reached the customer."
    );
  });

  it('is delivered (kept) when released before the promise', () => {
    const a = assess(
      promise('2026-12-10'),
      dev({ statusCategory: 'done', fixVersions: [version('2.3', '2026-11-27', true)] }),
      TODAY
    );
    expect(a.risk).toBe('delivered');
    expect(a.gapDays).toBe(-13);
    expect(a.reasons[0]).toMatchObject({ code: 'released', severity: 'success' });
    expect(a.reasons[0]?.message).toBe('Fixed and released on Nov 27, 13 days before the promised date (Dec 10).');
  });

  it('is delivered on the day', () => {
    const a = assess(promise('2026-11-29'), dev({ statusCategory: 'done', resolutionDate: '2026-11-29' }), TODAY);
    expect(a.reasons[0]?.message).toBe('Fixed on Nov 29, right on the promised date.');
  });

  it('is delivered late when shipped after the promise', () => {
    const a = assess(promise('2026-11-25'), dev({ statusCategory: 'done', resolutionDate: '2026-11-29' }), TODAY);
    expect(a.risk).toBe('delivered');
    expect(a.reasons[0]).toMatchObject({ code: 'delivered-late', severity: 'warning' });
    expect(a.gapDays).toBe(4);
  });

  it('keeps a fixed item waiting for a late release at risk', () => {
    const a = assess(
      promise('2026-12-10'),
      dev({ statusCategory: 'done', fixVersions: [version('2.4', '2026-12-16')] }),
      TODAY
    );
    expect(a.risk).toBe('at-risk');
    expect(a.reasons.map((r) => r.code)).toEqual(['release-after-promise', 'resolved-awaiting-release']);
  });
});

describe('isWorse', () => {
  it('only alerts when risk crosses into tight or worse', () => {
    expect(isWorse('at-risk', 'on-track')).toBe(true);
    expect(isWorse('tight', 'on-track')).toBe(true);
    expect(isWorse('broken', 'at-risk')).toBe(true);
    expect(isWorse('on-track', 'at-risk')).toBe(false);
    expect(isWorse('at-risk', 'at-risk')).toBe(false);
    expect(isWorse('unplanned', 'on-track')).toBe(false);
    expect(isWorse('at-risk', undefined)).toBe(true);
    expect(isWorse('on-track', undefined)).toBe(false);
  });
});

describe('worstRisk', () => {
  it('returns the worst of several', () => {
    expect(worstRisk(['on-track', 'broken', 'tight'])).toBe('broken');
    expect(worstRisk([])).toBeUndefined();
  });
});
