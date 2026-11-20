// Pure part of re-evaluation: given a promise and the fresh plan, what changes?
// Kept separate from I/O so every transition can be unit tested.
import { formatDateWithDay } from './dates';
import { RISK_STYLE } from './labels';
import { assess, isWorse, RISK_RANK } from './risk';
import type { DevSnapshot, Evidence, HistoryEvent, IsoDate, PromiseRecord, Reason, Settings } from './types';

export interface ChangeEvidence extends Evidence {
  text: string;
}

export interface Transition {
  next: PromiseRecord;
  /** True when the risk got worse and crossed into tight/at-risk/broken: tell support. */
  alert: boolean;
  riskChanged: boolean;
  previousRisk: PromiseRecord['risk'];
}

export function applyAssessment(
  p: PromiseRecord,
  dev: DevSnapshot | undefined,
  today: IsoDate,
  settings: Settings,
  now: string,
  evidence: ChangeEvidence[] = []
): Transition {
  const a = assess(p, dev, today, settings);
  const previousRisk = p.risk;
  const riskChanged = a.risk !== previousRisk;
  const reasons: Reason[] = [...a.reasons];
  if (evidence.length > 0 && (riskChanged || a.risk === 'at-risk' || a.risk === 'tight')) {
    for (const e of evidence.slice(0, 3)) {
      reasons.push({
        code: 'recent-change',
        severity: 'info',
        message: `${e.text}${e.by ? ` by ${e.by}` : ''}${e.at ? ` on ${formatDateWithDay(e.at.slice(0, 10), today)}` : ''}.`,
        evidence: { field: e.field, from: e.from, to: e.to, by: e.by, at: e.at },
      });
    }
  } else if (!riskChanged) {
    // Keep the last "what changed" note while the risk stays the same.
    reasons.push(...p.reasons.filter((r) => r.code === 'recent-change'));
  }

  const history: HistoryEvent[] = [...p.history];
  let state = p.state;
  if (riskChanged && p.state !== 'suggested') {
    history.push({
      at: now,
      type: 'risk',
      text: `${RISK_STYLE[previousRisk]?.label ?? previousRisk} → ${RISK_STYLE[a.risk].label}: ${a.reasons[0]?.message ?? ''}`,
    });
  }
  if (a.risk === 'delivered' && p.state === 'open') {
    state = (a.gapDays ?? 0) > 0 ? 'kept-late' : 'kept';
    history.push({ at: now, type: 'kept', text: a.reasons[0]?.message ?? 'Delivered' });
  }

  const alert = p.state === 'open' && isWorse(a.risk, p.lastAlertedRisk);
  // When things improve, lower the bar again so a later slip alerts once more.
  let lastAlertedRisk = p.lastAlertedRisk;
  if (alert) lastAlertedRisk = a.risk;
  else if (lastAlertedRisk && RISK_RANK[a.risk] < RISK_RANK[lastAlertedRisk]) lastAlertedRisk = a.risk;

  return {
    previousRisk,
    riskChanged,
    alert,
    next: {
      ...p,
      state,
      risk: a.risk,
      riskRank: a.rank,
      expectedDate: a.expected.date,
      expectedSource: a.expected.source,
      reasons: reasons.slice(0, 6),
      lastAlertedRisk,
      history,
      updatedAt: now,
    },
  };
}

/** Summary written to the request's indexed property (drives JQL and the queue). */
export function requestSummary(promises: PromiseRecord[]) {
  const live = promises.filter((p) => p.state === 'open');
  const worst = [...live].sort((a, b) => b.riskRank - a.riskRank)[0];
  const earliest = live.map((p) => p.promisedDate).sort()[0];
  return {
    risk: worst?.risk ?? (promises.some((p) => p.state === 'kept' || p.state === 'kept-late') ? 'delivered' : 'none'),
    rank: worst?.riskRank ?? 0,
    promiseDate: earliest,
    promises: live.length,
    suggested: promises.filter((p) => p.state === 'suggested').length,
  };
}

/** Summary written to the dev work item's indexed property. */
export function devSummary(promises: PromiseRecord[]) {
  const live = promises.filter((p) => p.state === 'open');
  return {
    waiting: new Set(live.map((p) => p.requestKey)).size,
    earliestPromise: live.map((p) => p.promisedDate).sort()[0],
    atRisk: live.filter((p) => p.risk === 'at-risk' || p.risk === 'broken').length,
  };
}
