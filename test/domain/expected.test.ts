import { describe, expect, it } from 'vitest';
import { describePlan, expectedDelivery } from '../../src/domain/expected';
import { TODAY, dev, sprint, version } from '../fixtures/dev';

describe('expectedDelivery', () => {
  it('uses the release date when the work item has a dated release', () => {
    const e = expectedDelivery(dev({ fixVersions: [version('2.4', '2026-12-10')] }), TODAY);
    expect(e).toMatchObject({ delivered: false, date: '2026-12-10', source: 'release' });
  });

  it('picks the earliest unreleased dated release', () => {
    const e = expectedDelivery(
      dev({ fixVersions: [version('2.5', '2026-12-20'), version('2.4', '2026-12-10'), version('2.3', '2026-11-01', true)] }),
      TODAY
    );
    expect(e.date).toBe('2026-12-10');
  });

  it('uses the sprint end when the sprint ends after the release, and says so', () => {
    const e = expectedDelivery(
      dev({ fixVersions: [version('2.4', '2026-12-10')], sprints: [sprint('Sprint 15', '2026-12-17')] }),
      TODAY
    );
    expect(e).toMatchObject({ date: '2026-12-17', source: 'sprint' });
    expect(e.notes.map((n) => n.code)).toContain('sprint-after-release');
  });

  it('keeps the release date when the sprint ends before it', () => {
    const e = expectedDelivery(
      dev({ fixVersions: [version('2.4', '2026-12-10')], sprints: [sprint('Sprint 14', '2026-12-08')] }),
      TODAY
    );
    expect(e).toMatchObject({ date: '2026-12-10', source: 'release' });
    expect(e.notes).toHaveLength(0);
  });

  it('uses the active sprint when there is no dated release', () => {
    const e = expectedDelivery(
      dev({ sprints: [sprint('Sprint 13', '2026-11-20', 'closed', 3), sprint('Sprint 14', '2026-12-08', 'active', 4)] }),
      TODAY
    );
    expect(e).toMatchObject({ date: '2026-12-08', source: 'sprint' });
  });

  it('uses the earliest future sprint when not in an active one', () => {
    const e = expectedDelivery(
      dev({ sprints: [sprint('Sprint 16', '2026-12-30', 'future', 6), sprint('Sprint 15', '2026-12-17', 'future', 5)] }),
      TODAY
    );
    expect(e).toMatchObject({ date: '2026-12-17', source: 'sprint' });
  });

  it('falls back to the due date', () => {
    expect(expectedDelivery(dev({ dueDate: '2026-12-05' }), TODAY)).toMatchObject({ date: '2026-12-05', source: 'due' });
  });

  it('returns no date when nothing is planned', () => {
    const e = expectedDelivery(dev(), TODAY);
    expect(e.date).toBeUndefined();
    expect(e.delivered).toBe(false);
  });

  it('treats overdue plans as "not before today"', () => {
    expect(expectedDelivery(dev({ sprints: [sprint('Sprint 13', '2026-11-28')] }), TODAY).date).toBe(TODAY);
    const e = expectedDelivery(dev({ fixVersions: [version('2.3', '2026-11-25')] }), TODAY);
    expect(e.date).toBe(TODAY);
    expect(e.notes[0]?.message).toContain("hasn't shipped");
  });

  it('marks done work without releases as delivered at the resolution date', () => {
    const e = expectedDelivery(dev({ statusCategory: 'done', status: 'Done', resolutionDate: '2026-11-29' }), TODAY);
    expect(e).toMatchObject({ delivered: true, deliveredAt: '2026-11-29', source: 'resolved' });
  });

  it('marks done work in a released version as delivered at the release date', () => {
    const e = expectedDelivery(
      dev({ statusCategory: 'done', resolutionDate: '2026-11-20', fixVersions: [version('2.3', '2026-11-27', true)] }),
      TODAY
    );
    expect(e).toMatchObject({ delivered: true, deliveredAt: '2026-11-27', source: 'released' });
  });

  it('falls back to today for done work with no dates at all', () => {
    expect(expectedDelivery(dev({ statusCategory: 'done' }), TODAY)).toMatchObject({ delivered: true, deliveredAt: TODAY });
  });

  it('keeps done work waiting for an unreleased version as not delivered', () => {
    const e = expectedDelivery(
      dev({ statusCategory: 'done', fixVersions: [version('2.4', '2026-12-10')] }),
      TODAY
    );
    expect(e).toMatchObject({ delivered: false, date: '2026-12-10', source: 'release' });
    expect(e.notes[0]?.code).toBe('resolved-awaiting-release');
  });

  it('handles done work waiting for a release with no date', () => {
    const e = expectedDelivery(dev({ statusCategory: 'done', fixVersions: [version('2.4')] }), TODAY);
    expect(e.delivered).toBe(false);
    expect(e.date).toBeUndefined();
    expect(e.notes[0]?.message).toContain('no date yet');
  });
});

describe('describePlan', () => {
  it('summarises sprint and release', () => {
    expect(
      describePlan(dev({ fixVersions: [version('2.4', '2026-12-10')], sprints: [sprint('Sprint 14', '2026-12-08')] }), TODAY)
    ).toBe('Sprint 14 (ends Dec 8) · release 2.4 (Dec 10)');
  });
  it('mentions undated releases, due dates, and unplanned work', () => {
    expect(describePlan(dev({ fixVersions: [version('2.4')] }), TODAY)).toBe('release 2.4 (no date)');
    expect(describePlan(dev({ dueDate: '2026-12-05' }), TODAY)).toBe('due Dec 5');
    expect(describePlan(dev(), TODAY)).toBe('Not planned yet');
    expect(describePlan(dev({ sprints: [{ id: 1, name: 'Sprint X', state: 'future' }] }), TODAY)).toBe('Sprint X');
  });
});
