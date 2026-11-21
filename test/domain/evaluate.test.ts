import { describe, expect, it } from 'vitest';
import { applyAssessment, customerFor, devSummary, requestSummary } from '../../src/domain/evaluate';
import { DEFAULT_SETTINGS, type PromiseRecord } from '../../src/domain/types';
import { TODAY, dev, sprint, version } from '../fixtures/dev';

const NOW = '2026-12-01T10:00:00.000Z';

function promise(overrides: Partial<PromiseRecord> = {}): PromiseRecord {
  return {
    id: 'p1',
    requestKey: 'SUP-1',
    projectKey: 'SUP',
    devIssueKey: 'BUG-12',
    customer: 'Acme Corp',
    promisedDate: '2026-12-12',
    text: 'Fix in 2.4',
    source: 'manual',
    madeAt: NOW,
    state: 'open',
    risk: 'on-track',
    riskRank: 1,
    reasons: [],
    lastAlertedRisk: 'on-track',
    history: [],
    updatedAt: NOW,
    ...overrides,
  };
}

const onTrackDev = dev({ fixVersions: [version('2.4', '2026-12-10')], sprints: [sprint('Sprint 14', '2026-12-09')] });
const slippedDev = dev({ fixVersions: [version('2.4', '2026-12-10')], sprints: [sprint('Sprint 15', '2026-12-23', 'future')] });
const move = [{ field: 'sprint', from: '14', to: '15', by: 'Dev Patel', at: '2026-12-03T09:00:00Z', text: 'Moved from Sprint 14 to Sprint 15' }];

describe('applyAssessment', () => {
  it('stays quiet when nothing changes', () => {
    const t = applyAssessment(promise(), onTrackDev, TODAY, DEFAULT_SETTINGS, NOW);
    expect(t.next.risk).toBe('on-track');
    expect(t.riskChanged).toBe(false);
    expect(t.alert).toBe(false);
    expect(t.next.history).toHaveLength(0);
  });

  it('alerts once when the developer moves the work to a later sprint (the demo)', () => {
    const t = applyAssessment(promise(), slippedDev, TODAY, DEFAULT_SETTINGS, NOW, move);
    expect(t.next.risk).toBe('at-risk');
    expect(t.alert).toBe(true);
    expect(t.next.lastAlertedRisk).toBe('at-risk');
    expect(t.next.expectedDate).toBe('2026-12-23');
    expect(t.next.reasons.map((r) => r.code)).toEqual(['sprint-after-promise', 'sprint-after-release', 'recent-change']);
    expect(t.next.reasons.at(-1)?.message).toBe('Moved from Sprint 14 to Sprint 15 by Dev Patel on Thu, Dec 3.');
    expect(t.next.history.at(-1)?.text).toMatch(/^On track → At risk: /);

    // Same state again: no second alert.
    const again = applyAssessment(t.next, slippedDev, TODAY, DEFAULT_SETTINGS, NOW);
    expect(again.alert).toBe(false);
    expect(again.riskChanged).toBe(false);
    // The "what changed" note is kept while the risk stays the same.
    expect(again.next.reasons.some((r) => r.code === 'recent-change')).toBe(true);
  });

  it('recovers quietly, then alerts again on a new slip', () => {
    const atRisk = applyAssessment(promise(), slippedDev, TODAY, DEFAULT_SETTINGS, NOW).next;
    const back = applyAssessment(atRisk, onTrackDev, TODAY, DEFAULT_SETTINGS, NOW);
    expect(back.next.risk).toBe('on-track');
    expect(back.alert).toBe(false);
    expect(back.next.lastAlertedRisk).toBe('on-track');
    const slipAgain = applyAssessment(back.next, slippedDev, TODAY, DEFAULT_SETTINGS, NOW);
    expect(slipAgain.alert).toBe(true);
  });

  it('escalates from at risk to broken with a second alert', () => {
    const atRisk = applyAssessment(promise({ promisedDate: '2026-12-02' }), slippedDev, TODAY, DEFAULT_SETTINGS, NOW).next;
    const broken = applyAssessment(atRisk, slippedDev, '2026-12-04', DEFAULT_SETTINGS, NOW);
    expect(broken.next.risk).toBe('broken');
    expect(broken.alert).toBe(true);
  });

  it('closes the promise as kept when the fix ships in time', () => {
    const shipped = dev({ statusCategory: 'done', fixVersions: [version('2.4', '2026-11-30', true)] });
    const t = applyAssessment(promise(), shipped, TODAY, DEFAULT_SETTINGS, NOW);
    expect(t.next.state).toBe('kept');
    expect(t.next.risk).toBe('delivered');
    expect(t.next.history.at(-1)?.type).toBe('kept');
    expect(t.alert).toBe(false);
  });

  it('closes the promise as kept late when the fix ships after the date', () => {
    const late = dev({ statusCategory: 'done', resolutionDate: '2026-11-30' });
    const t = applyAssessment(promise({ promisedDate: '2026-11-28', risk: 'broken', lastAlertedRisk: 'broken' }), late, TODAY, DEFAULT_SETTINGS, NOW);
    expect(t.next.state).toBe('kept-late');
  });

  it('never alerts for suggestions and keeps their history clean', () => {
    const t = applyAssessment(promise({ state: 'suggested', lastAlertedRisk: undefined, risk: 'unknown' }), slippedDev, TODAY, DEFAULT_SETTINGS, NOW);
    expect(t.next.risk).toBe('at-risk');
    expect(t.alert).toBe(false);
    expect(t.next.history).toHaveLength(0);
    expect(t.next.state).toBe('suggested');
  });

  it('reports a missing dev item without alerting from unknown', () => {
    const t = applyAssessment(promise({ devIssueKey: undefined }), undefined, TODAY, DEFAULT_SETTINGS, NOW);
    expect(t.next.risk).toBe('unknown');
    expect(t.alert).toBe(false);
  });
});

describe('summaries for JQL', () => {
  const list = [
    promise({ id: 'a', risk: 'on-track', riskRank: 1, promisedDate: '2026-12-12' }),
    promise({ id: 'b', requestKey: 'SUP-2', risk: 'at-risk', riskRank: 4, promisedDate: '2026-12-08' }),
    promise({ id: 'c', state: 'suggested', risk: 'tight', riskRank: 3 }),
    promise({ id: 'd', state: 'kept', risk: 'delivered', riskRank: 0 }),
  ];

  it('summarises a request by its worst open promise', () => {
    expect(requestSummary(list)).toEqual({ risk: 'at-risk', rank: 4, promiseDate: '2026-12-08', promises: 2, suggested: 1 });
    expect(requestSummary([list[3]!])).toMatchObject({ risk: 'delivered', promises: 0 });
    expect(requestSummary([])).toMatchObject({ risk: 'none', rank: 0, promises: 0 });
  });

  it('summarises a dev item by distinct requests waiting', () => {
    expect(devSummary(list)).toEqual({ waiting: 2, earliestPromise: '2026-12-08', atRisk: 1 });
  });
});

describe('customerFor', () => {
  it('reuses the customer name from the latest promise on the request', () => {
    const older = promise({ id: 'a', customer: 'Acme Corp', madeAt: '2026-11-01T10:00:00.000Z' });
    const newer = promise({ id: 'b', customer: 'Acme (EMEA)', madeAt: '2026-11-20T10:00:00.000Z' });
    expect(customerFor([older, newer], 'Sam Lee')).toBe('Acme (EMEA)');
  });

  it('falls back to the organization or reporter when there are no promises', () => {
    expect(customerFor([], 'Sam Lee')).toBe('Sam Lee');
    expect(customerFor([promise({ customer: '  ' })], 'Sam Lee')).toBe('Sam Lee');
  });
});
