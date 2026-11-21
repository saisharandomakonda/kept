// Read models for the UI and Rovo: the fix chain behind a request, the customers waiting on
// a dev work item, and the promises overview for support leads.
import { addDays, daysBetween } from '../domain/dates';
import { describePlan } from '../domain/expected';
import { customerFor, requestSummary } from '../domain/evaluate';
import { RISK_RANK } from '../domain/risk';
import { RISK_STYLE } from '../domain/labels';
import type { DevSnapshot, PromiseRecord, RiskLevel } from '../domain/types';
import { getDevSnapshots, getRequest, type RequestInfo } from '../jira/issues';
import { browsableSpaces } from '../jira/permissions';
import { isServiceSpace } from '../jira/projects';
import { ALL_STATES, promisesByState, promisesForDevItem, promisesForRequest } from '../store/promises';
import { getSettings } from '../store/settings';
import { today } from './clock';

export interface DevItemView {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  plan: string;
  assignee?: string;
  relation: string;
  projectName?: string;
}

/** Linked work items that live outside service spaces: the developer side of the chain. */
export async function devItemsOf(request: RequestInfo): Promise<{ items: DevItemView[]; snapshots: Map<string, DevSnapshot> }> {
  const snapshots = await getDevSnapshots(request.links.map((l) => l.key));
  const items: DevItemView[] = [];
  const day = today();
  for (const link of request.links) {
    const s = snapshots.get(link.key);
    if (!s || s.projectKey === request.projectKey || (await isServiceSpace(s.projectKey))) {
      snapshots.delete(link.key);
      continue;
    }
    items.push({
      key: s.key,
      summary: s.summary,
      status: s.status,
      statusCategory: s.statusCategory,
      plan: describePlan(s, day),
      assignee: s.assigneeName,
      relation: link.relation,
      projectName: s.projectName,
    });
  }
  return { items, snapshots };
}

const ORDER: Record<string, number> = { suggested: 0, open: 1, kept: 2, 'kept-late': 3, broken: 4, replaced: 5, withdrawn: 6 };

export function sortPromises(list: PromiseRecord[]): PromiseRecord[] {
  return [...list].sort(
    (a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) || b.riskRank - a.riskRank || a.promisedDate.localeCompare(b.promisedDate)
  );
}

export async function requestView(requestKey: string) {
  const request = await getRequest(requestKey, 'user');
  if (!request) return { found: false as const };
  const [{ items }, promises, settings] = await Promise.all([devItemsOf(request), promisesForRequest(requestKey), getSettings()]);
  const summary = requestSummary(promises);
  return {
    found: true as const,
    today: today(),
    request: {
      key: request.key,
      summary: request.summary,
      status: request.status,
      customer: customerFor(promises, request.customer),
      reporterName: request.reporterName,
      reporterId: request.reporterId,
    },
    devItems: items,
    promises: sortPromises(promises),
    summary,
    settings: { detectPromises: settings.detectPromises },
  };
}

export async function devView(devKey: string) {
  const promises = (await promisesForDevItem(devKey)).filter((p) => p.state === 'open' || p.state === 'kept' || p.state === 'kept-late');
  const byRequest = new Map<string, PromiseRecord[]>();
  for (const p of promises) byRequest.set(p.requestKey, [...(byRequest.get(p.requestKey) ?? []), p]);
  const open = promises.filter((p) => p.state === 'open');
  return {
    today: today(),
    waiting: new Set(open.map((p) => p.requestKey)).size,
    atRisk: open.filter((p) => p.risk === 'at-risk' || p.risk === 'broken').length,
    earliest: open.map((p) => p.promisedDate).sort()[0],
    promises: sortPromises(promises),
  };
}

export interface DashboardRow {
  id: string;
  requestKey: string;
  projectKey: string;
  customer: string;
  promisedDate: string;
  expectedDate?: string;
  risk: RiskLevel;
  state: string;
  why: string;
  devIssueKey?: string;
  customerToldAt?: string;
  daysLeft: number;
}

/** The promises overview, limited to the spaces the signed-in person can browse. */
export async function dashboard(projectKey?: string) {
  const day = today();
  const [open, suggested, kept, keptLate] = await Promise.all([
    promisesByState('open'),
    promisesByState('suggested'),
    promisesByState('kept', addDays(day, -90)),
    promisesByState('kept-late', addDays(day, -90)),
  ]);
  const all = [...open, ...suggested, ...kept, ...keptLate].filter((p) => !projectKey || p.projectKey === projectKey);
  const visible = await browsableSpaces(all.map((p) => p.projectKey));
  const inScope = (p: PromiseRecord) => (!projectKey || p.projectKey === projectKey) && visible.has(p.projectKey);
  const toRow = (p: PromiseRecord): DashboardRow => ({
    id: p.id,
    requestKey: p.requestKey,
    projectKey: p.projectKey,
    customer: p.customer,
    promisedDate: p.promisedDate,
    expectedDate: p.expectedDate,
    risk: p.risk,
    state: p.state,
    why: p.reasons.find((r) => r.code !== 'recent-change')?.message ?? '',
    devIssueKey: p.devIssueKey,
    customerToldAt: p.customerToldAt,
    daysLeft: daysBetween(day, p.promisedDate),
  });
  const openRows = open.filter(inScope).map(toRow).sort((a, b) => RISK_RANK[b.risk] - RISK_RANK[a.risk] || a.daysLeft - b.daysLeft);
  const closed = [...kept, ...keptLate].filter(inScope);
  const brokenOpen = openRows.filter((r) => r.risk === 'broken').length;
  const keptOnTime = closed.filter((p) => p.state === 'kept').length;
  const denominator = closed.length + brokenOpen;

  // Promises per week for the next 6 weeks, split by risk.
  const weeks = Array.from({ length: 6 }, (_, i) => addDays(day, i * 7));
  const chart: { week: string; risk: string; count: number }[] = [];
  for (const [i, start] of weeks.entries()) {
    const end = addDays(start, 7);
    const inWeek = openRows.filter((r) => r.promisedDate >= start && r.promisedDate < end);
    for (const risk of ['on-track', 'tight', 'at-risk', 'unplanned'] as const) {
      const count = inWeek.filter((r) => r.risk === risk || (risk === 'unplanned' && r.risk === 'unknown')).length;
      chart.push({ week: i === 0 ? 'This week' : `Week +${i}`, risk: RISK_STYLE[risk].label, count });
    }
  }

  return {
    today: day,
    counts: {
      open: openRows.length,
      atRisk: openRows.filter((r) => r.risk === 'at-risk').length,
      broken: brokenOpen,
      dueThisWeek: openRows.filter((r) => r.daysLeft >= 0 && r.daysLeft <= 7).length,
      suggested: suggested.filter(inScope).length,
      keptRate: denominator > 0 ? Math.round((keptOnTime / denominator) * 100) : null,
      keptCount: keptOnTime,
      closedCount: closed.length,
    },
    rows: openRows,
    recent: closed
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 10)
      .map(toRow),
    chart,
  };
}

export { ALL_STATES };
