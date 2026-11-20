// The risk engine: compares a promise with the real plan for the fix and explains the result.
// Deterministic on purpose, so every decision can be explained and tested.
import { daysBetween, formatDate, plural, relativeDays } from './dates';
import { expectedDelivery, openSprint, nextRelease } from './expected';
import type { Assessment, DevSnapshot, IsoDate, Reason, RiskLevel, Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

export const RISK_RANK: Record<RiskLevel, number> = {
  delivered: 0,
  'on-track': 1,
  unknown: 2,
  unplanned: 2,
  tight: 3,
  'at-risk': 4,
  broken: 5,
};

/** Higher means worse. Used to decide whether a change deserves an alert. */
export function isWorse(next: RiskLevel, previous: RiskLevel | undefined): boolean {
  if (!previous) return RISK_RANK[next] >= RISK_RANK['tight'];
  return RISK_RANK[next] > RISK_RANK[previous] && RISK_RANK[next] >= RISK_RANK['tight'];
}

export interface PromiseInput {
  promisedDate: IsoDate;
}

export function assess(
  promise: PromiseInput,
  dev: DevSnapshot | undefined,
  today: IsoDate,
  settings: Settings = DEFAULT_SETTINGS
): Assessment {
  const promised = promise.promisedDate;
  const daysLeft = daysBetween(today, promised);
  const p = formatDate(promised, today);

  if (!dev) {
    return {
      risk: 'unknown',
      rank: RISK_RANK.unknown,
      expected: { delivered: false, notes: [] },
      daysLeft,
      reasons: [
        {
          code: 'no-dev-item',
          severity: 'warning',
          message: "No developer work item is linked, so Kept can't follow the fix. Link the work item the fix depends on.",
        },
      ],
    };
  }

  const expected = expectedDelivery(dev, today);

  if (expected.delivered) {
    const at = expected.deliveredAt as IsoDate;
    const late = daysBetween(promised, at);
    const how = expected.source === 'released' ? 'Fixed and released' : 'Fixed';
    const reason: Reason =
      late > 0
        ? {
            code: 'delivered-late',
            severity: 'warning',
            message: `${how} on ${formatDate(at, today)}, ${plural(late, 'day')} after the promised date (${p}).`,
          }
        : {
            code: 'released',
            severity: 'success',
            message:
              late === 0
                ? `${how} on ${formatDate(at, today)}, right on the promised date.`
                : `${how} on ${formatDate(at, today)}, ${plural(-late, 'day')} before the promised date (${p}).`,
          };
    return { risk: 'delivered', rank: RISK_RANK.delivered, expected, daysLeft, gapDays: late, reasons: [reason] };
  }

  const reasons: Reason[] = [];

  if (daysLeft < 0) {
    reasons.push({
      code: 'past-promise',
      severity: 'danger',
      message: `The promised date (${p}) passed ${plural(-daysLeft, 'day')} ago and the fix hasn't reached the customer.`,
    });
    reasons.push(...expected.notes);
    return { risk: 'broken', rank: RISK_RANK.broken, expected, daysLeft, reasons };
  }

  if (!expected.date) {
    const awaiting = expected.notes.find((n) => n.code === 'resolved-awaiting-release');
    if (daysLeft <= settings.unplannedWarnDays) {
      reasons.push({
        code: 'no-plan-soon',
        severity: 'danger',
        message: awaiting
          ? `${awaiting.message} The customer was promised ${p} (${relativeDays(daysLeft)}).`
          : `${dev.key} has no sprint, release or due date, but the customer was promised ${p} (${relativeDays(daysLeft)}).`,
      });
      return { risk: 'at-risk', rank: RISK_RANK['at-risk'], expected, daysLeft, reasons };
    }
    reasons.push({
      code: 'no-plan',
      severity: 'info',
      message: awaiting
        ? `${awaiting.message} The promise is ${p} (${relativeDays(daysLeft)}).`
        : `${dev.key} isn't planned yet. The promise is ${p} (${relativeDays(daysLeft)}).`,
    });
    return { risk: 'unplanned', rank: RISK_RANK.unplanned, expected, daysLeft, reasons };
  }

  const exp = expected.date;
  const gap = daysBetween(promised, exp);
  const e = formatDate(exp, today);

  if (gap > 0) {
    reasons.push(lateReason(dev, expected.source, e, p, gap));
    reasons.push(...expected.notes.filter((n) => n.code !== 'release-after-promise' || expected.source === 'release'));
    return { risk: 'at-risk', rank: RISK_RANK['at-risk'], expected, daysLeft, gapDays: gap, reasons };
  }

  if (dev.statusCategory === 'new' && daysLeft <= settings.notStartedWarnDays) {
    reasons.push({
      code: 'not-started-soon',
      severity: 'danger',
      message: `Work on ${dev.key} hasn't started (status: ${dev.status}) and the promise is ${relativeDays(daysLeft)} (${p}).`,
    });
    reasons.push(...expected.notes);
    return { risk: 'at-risk', rank: RISK_RANK['at-risk'], expected, daysLeft, gapDays: gap, reasons };
  }

  const insideBuffer = -gap < settings.bufferDays;
  const mayMissRelease = expected.notes.some((n) => n.code === 'sprint-after-release');
  if (insideBuffer || mayMissRelease) {
    if (insideBuffer) {
      reasons.push({
        code: 'tight',
        severity: 'warning',
        message:
          gap === 0
            ? `${planStatement(dev, expected.source, e)}, the same day as the promise. No room for a slip.`
            : `${planStatement(dev, expected.source, e)}, only ${plural(-gap, 'day')} before the promise (${p}).`,
      });
    }
    reasons.push(...expected.notes);
    return { risk: 'tight', rank: RISK_RANK.tight, expected, daysLeft, gapDays: gap, reasons };
  }

  reasons.push({
    code: 'on-track',
    severity: 'success',
    message: `${planStatement(dev, expected.source, e)}, ${plural(-gap, 'day')} before the promise (${p}).`,
  });
  reasons.push(...expected.notes);
  return { risk: 'on-track', rank: RISK_RANK['on-track'], expected, daysLeft, gapDays: gap, reasons };
}

/** "Release 2.4 ships Dec 8" / "BUG-12 is in Sprint 14, ending Dec 8" / "BUG-12 is due Dec 8". */
export function planStatement(dev: DevSnapshot, source: string | undefined, expected: string): string {
  if (source === 'release') {
    const r = nextRelease(dev.fixVersions);
    return `Release ${r?.name ?? ''} ships ${expected}`.replace('  ', ' ');
  }
  if (source === 'sprint') {
    const s = openSprint(dev.sprints);
    return `${dev.key} is in ${s?.name ?? 'a sprint'}, ending ${expected}`;
  }
  if (source === 'due') return `${dev.key} is due ${expected}`;
  return `${dev.key} is expected ${expected}`;
}

function lateReason(
  dev: DevSnapshot,
  source: string | undefined,
  expected: string,
  promised: string,
  gap: number
): Reason {
  const late = plural(gap, 'day');
  if (source === 'release') {
    const r = nextRelease(dev.fixVersions);
    return {
      code: 'release-after-promise',
      severity: 'danger',
      message: `Release ${r?.name ?? ''} is planned for ${expected}, ${late} after the promised date (${promised}).`,
    };
  }
  if (source === 'sprint') {
    const s = openSprint(dev.sprints);
    return {
      code: 'sprint-after-promise',
      severity: 'danger',
      message: `${dev.key} is in ${s?.name ?? 'a sprint'}, which ends ${expected}, ${late} after the promised date (${promised}).`,
    };
  }
  return {
    code: 'due-after-promise',
    severity: 'danger',
    message: `${dev.key} is due ${expected}, ${late} after the promised date (${promised}).`,
  };
}

/** The worst risk among several promises (for the request's badge). */
export function worstRisk(risks: RiskLevel[]): RiskLevel | undefined {
  return [...risks].sort((a, b) => RISK_RANK[b] - RISK_RANK[a])[0];
}
