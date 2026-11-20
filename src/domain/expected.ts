// When will the fix actually reach the customer?
// Order of trust: a release with a date > the sprint the work is in > the work item's due date.
import { daysBetween, formatDate, maxDate } from './dates';
import type { DevSnapshot, Expected, IsoDate, Reason, SprintInfo, VersionInfo } from './types';

function openSprint(sprints: SprintInfo[]): SprintInfo | undefined {
  const active = sprints.find((s) => s.state === 'active');
  if (active) return active;
  return sprints
    .filter((s) => s.state === 'future')
    .sort((a, b) => (a.endDate ?? '9999').localeCompare(b.endDate ?? '9999'))[0];
}

function nextRelease(versions: VersionInfo[]): VersionInfo | undefined {
  return versions
    .filter((v) => !v.released && v.releaseDate)
    .sort((a, b) => (a.releaseDate as string).localeCompare(b.releaseDate as string))[0];
}

export function expectedDelivery(dev: DevSnapshot, today: IsoDate): Expected {
  const notes: Reason[] = [];
  const unreleased = dev.fixVersions.filter((v) => !v.released);
  const released = dev.fixVersions.filter((v) => v.released);
  const release = nextRelease(dev.fixVersions);
  const sprint = openSprint(dev.sprints);

  if (dev.statusCategory === 'done') {
    if (unreleased.length === 0) {
      // Done and shipped (or the team doesn't use releases).
      const releasedAt = maxDate(...released.map((v) => v.releaseDate));
      const deliveredAt = released.length > 0 ? releasedAt ?? dev.resolutionDate : dev.resolutionDate;
      return {
        delivered: true,
        deliveredAt: deliveredAt ?? today,
        date: deliveredAt ?? today,
        source: released.length > 0 ? 'released' : 'resolved',
        notes,
      };
    }
    // Fixed in code, waiting for a release to reach customers.
    const waiting = release ?? unreleased[0];
    notes.push({
      code: 'resolved-awaiting-release',
      severity: 'info',
      message: release
        ? `${dev.key} is fixed and waiting for release ${release.name} on ${formatDate(release.releaseDate as IsoDate, today)}.`
        : `${dev.key} is fixed and waiting for release ${waiting?.name ?? ''}, which has no date yet.`,
    });
    if (release?.releaseDate) {
      return { delivered: false, date: atLeastToday(release.releaseDate, today), source: 'release', notes };
    }
    return { delivered: false, notes };
  }

  if (release?.releaseDate) {
    if (release.releaseDate < today) {
      notes.push({
        code: 'release-after-promise',
        severity: 'warning',
        message: `Release ${release.name} was planned for ${formatDate(release.releaseDate, today)} and hasn't shipped yet.`,
      });
    }
    if (sprint?.endDate && sprint.endDate > release.releaseDate) {
      notes.push({
        code: 'sprint-after-release',
        severity: 'warning',
        message: `${dev.key} is in ${sprint.name}, which ends ${formatDate(sprint.endDate, today)}, after release ${release.name} (${formatDate(release.releaseDate, today)}). The fix may miss that release.`,
      });
      // The work can't ship before it's built: use the later of the two.
      return { delivered: false, date: atLeastToday(sprint.endDate, today), source: 'sprint', notes };
    }
    return { delivered: false, date: atLeastToday(release.releaseDate, today), source: 'release', notes };
  }

  if (sprint?.endDate) {
    return { delivered: false, date: atLeastToday(sprint.endDate, today), source: 'sprint', notes };
  }

  if (dev.dueDate) {
    return { delivered: false, date: atLeastToday(dev.dueDate, today), source: 'due', notes };
  }

  return { delivered: false, notes };
}

/** A plan date in the past that hasn't happened means "not before today". */
function atLeastToday(date: IsoDate, today: IsoDate): IsoDate {
  return daysBetween(today, date) < 0 ? today : date;
}

export function describePlan(dev: DevSnapshot, today: IsoDate): string {
  const release = nextRelease(dev.fixVersions);
  const sprint = openSprint(dev.sprints);
  const parts: string[] = [];
  if (sprint) parts.push(sprint.endDate ? `${sprint.name} (ends ${formatDate(sprint.endDate, today)})` : sprint.name);
  if (release?.releaseDate) parts.push(`release ${release.name} (${formatDate(release.releaseDate, today)})`);
  else if (dev.fixVersions.some((v) => !v.released)) parts.push(`release ${dev.fixVersions.find((v) => !v.released)?.name} (no date)`);
  if (!sprint && !release && dev.dueDate) parts.push(`due ${formatDate(dev.dueDate, today)}`);
  return parts.length > 0 ? parts.join(' · ') : 'Not planned yet';
}

export { openSprint, nextRelease };
