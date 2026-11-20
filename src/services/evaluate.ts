// Re-evaluates promises against the live plan, saves the result, updates the JQL properties,
// and posts alerts when things get worse. State-based and idempotent: safe to run any time.
import { applyAssessment, devSummary, requestSummary, type ChangeEvidence } from '../domain/evaluate';
import type { DevSnapshot, PromiseRecord } from '../domain/types';
import { addComment, addInternalNote } from '../jira/comments';
import { getDevSnapshots, getRequest } from '../jira/issues';
import { devItemsOf } from './chain';
import { today } from './clock';
import { setKeptProperty } from '../jira/properties';
import { browseUrl, claimOnce } from '../jira/site';
import { promisesForDevItem, promisesForRequest, promisesByState, savePromise } from '../store/promises';
import { getSettings } from '../store/settings';
import { devNote, requestNote } from './alerts';

export interface EvaluationResult {
  evaluated: number;
  alerts: string[];
  changed: string[];
}

export async function evaluatePromises(
  promises: PromiseRecord[],
  opts: { evidence?: Record<string, ChangeEvidence[]>; snapshots?: Map<string, DevSnapshot>; quiet?: boolean } = {}
): Promise<EvaluationResult> {
  const live = promises.filter((p) => p.state === 'open' || p.state === 'suggested');
  const result: EvaluationResult = { evaluated: live.length, alerts: [], changed: [] };
  if (live.length === 0) return result;

  const settings = await getSettings();
  const now = new Date().toISOString();
  const day = today();
  const snapshots = opts.snapshots ?? (await getDevSnapshots(live.map((p) => p.devIssueKey ?? '').filter(Boolean)));

  const alertsByRequest = new Map<string, PromiseRecord[]>();
  const alertsByDev = new Map<string, PromiseRecord[]>();
  const touchedRequests = new Set<string>();
  const touchedDevs = new Set<string>();

  for (const p of live) {
    const dev = p.devIssueKey ? snapshots.get(p.devIssueKey) : undefined;
    const t = applyAssessment(p, dev, day, settings, now, p.devIssueKey ? opts.evidence?.[p.devIssueKey] : undefined);
    const changed = JSON.stringify({ ...t.next, updatedAt: '' }) !== JSON.stringify({ ...p, updatedAt: '' });
    if (changed) {
      await savePromise(t.next);
      result.changed.push(p.id);
    }
    touchedRequests.add(p.requestKey);
    if (p.devIssueKey) touchedDevs.add(p.devIssueKey);
    if (t.alert && !opts.quiet && (await claimOnce(`alerted:${p.id}:${p.lastAlertedRisk ?? "none"}>${t.next.risk}:${p.history.length}:${p.updatedAt}`))) {
      alertsByRequest.set(p.requestKey, [...(alertsByRequest.get(p.requestKey) ?? []), t.next]);
      if (p.devIssueKey) alertsByDev.set(p.devIssueKey, [...(alertsByDev.get(p.devIssueKey) ?? []), t.next]);
    }
  }

  await refreshProperties([...touchedRequests], [...touchedDevs]);
  console.log(
    `Kept evaluated ${live.length} promise(s): ${result.changed.length} changed, alerts for ${[...alertsByRequest.keys()].join(',') || 'none'}`
  );

  for (const [requestKey, list] of alertsByRequest) {
    if (!settings.noteOnRequest) break;
    const dev: Record<string, string> = {};
    for (const p of list) if (p.devIssueKey) dev[p.devIssueKey] = await browseUrl(p.devIssueKey);
    try {
      await addInternalNote(requestKey, requestNote(list, day, { dev }));
      result.alerts.push(requestKey);
    } catch (e) {
      console.warn(`Kept: could not post internal note on ${requestKey}: ${(e as Error).message}`);
    }
  }
  for (const [devKey, list] of alertsByDev) {
    if (!settings.noteOnDevIssue) break;
    const request: Record<string, string> = {};
    for (const p of list) request[p.requestKey] = await browseUrl(p.requestKey);
    try {
      await addComment(devKey, devNote(list, day, { request }));
      result.alerts.push(devKey);
    } catch (e) {
      console.warn(`Kept: could not post heads-up on ${devKey}: ${(e as Error).message}`);
    }
  }
  return result;
}

/** Updates the indexed "kept" property on requests and dev work items. */
export async function refreshProperties(requestKeys: string[], devKeys: string[]): Promise<void> {
  for (const key of requestKeys) {
    const s = requestSummary(await promisesForRequest(key));
    await setKeptProperty(key, s).catch((e) => console.warn(`Kept: property on ${key}: ${(e as Error).message}`));
  }
  for (const key of devKeys) {
    const s = devSummary(await promisesForDevItem(key));
    await setKeptProperty(key, s).catch((e) => console.warn(`Kept: property on ${key}: ${(e as Error).message}`));
  }
}

export async function evaluateDevItems(devKeys: string[], evidence?: Record<string, ChangeEvidence[]>): Promise<EvaluationResult> {
  const promises: PromiseRecord[] = [];
  for (const key of new Set(devKeys)) promises.push(...(await promisesForDevItem(key)));
  return evaluatePromises(promises, { evidence });
}

/**
 * Re-checks a request: follows link changes (a promise whose work item was unlinked loses it;
 * a promise without one picks up a newly linked dev item), then evaluates.
 */
export async function evaluateRequest(requestKey: string): Promise<EvaluationResult> {
  const promises = await promisesForRequest(requestKey);
  const live = promises.filter((p) => p.state === 'open' || p.state === 'suggested');
  if (live.length === 0) return { evaluated: 0, alerts: [], changed: [] };
  const request = await getRequest(requestKey);
  if (!request) return { evaluated: 0, alerts: [], changed: [] };
  const linkedKeys = request.links.map((l) => l.key);
  const { items, snapshots } = await devItemsOf(request);
  const devKeys = items.map((i) => i.key);
  for (const p of live) {
    if (p.devIssueKey && !linkedKeys.includes(p.devIssueKey)) {
      p.history.push({ at: new Date().toISOString(), type: 'risk', text: `${p.devIssueKey} was unlinked from the request.` });
      p.devIssueKey = devKeys[0];
      await savePromise(p);
    } else if (!p.devIssueKey && devKeys[0]) {
      p.devIssueKey = devKeys[0];
      await savePromise(p);
    }
  }
  return evaluatePromises(live, { snapshots });
}

/** The hourly sweep: dates move even when nobody edits anything. */
export async function sweepAll(): Promise<EvaluationResult> {
  const open = await promisesByState('open');
  const total: EvaluationResult = { evaluated: 0, alerts: [], changed: [] };
  for (let i = 0; i < open.length; i += 40) {
    const r = await evaluatePromises(open.slice(i, i + 40));
    total.evaluated += r.evaluated;
    total.alerts.push(...r.alerts);
    total.changed.push(...r.changed);
  }
  return total;
}
