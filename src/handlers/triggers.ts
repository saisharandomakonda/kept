// Jira product events → re-evaluate the promises they can affect.
import { route } from '@forge/api';
import { relevantChanges, addedSprintIds, removedSprintIds, toEvidence } from '../domain/changes';
import type { ChangeEvidence } from '../domain/evaluate';
import { jiraGetOptional } from '../jira/http';
import { searchIssues } from '../jira/issues';
import { sprintNames } from '../jira/projects';
import { discoverFieldIds } from '../jira/fields';
import { displayName } from '../jira/users';
import { evaluateDevItems, evaluateRequest, sweepAll, refreshProperties } from '../services/evaluate';
import { detectInReply } from '../services/promises';
import { deletePromise, promisesForDevItem, promisesForRequest } from '../store/promises';

interface IssueEvent {
  eventType: string;
  issue: { id: string; key: string; fields?: { project?: { key?: string } } };
  changelog?: { items?: Record<string, unknown>[] };
  comment?: { id: string };
  atlassianId?: string;
  associatedUsers?: { accountId: string; displayName?: string }[];
}

async function actorName(event: IssueEvent): Promise<string | null> {
  const u = event.associatedUsers?.find((x) => x.accountId === event.atlassianId) ?? event.associatedUsers?.[0];
  return u?.displayName ?? (await displayName(event.atlassianId ?? u?.accountId));
}

export async function onIssueEvent(event: IssueEvent): Promise<void> {
  try {
    const key = event.issue?.key;
    if (!key) return;

    if (event.eventType === 'avi:jira:commented:issue' && event.comment?.id) {
      await detectInReply(key, event.comment.id);
      return;
    }

    if (event.eventType === 'avi:jira:deleted:issue') {
      const asDev = await promisesForDevItem(key);
      if (asDev.length > 0) await evaluateDevItems([key]);
      for (const p of await promisesForRequest(key)) await deletePromise(p.id);
      return;
    }

    // avi:jira:updated:issue
    const changes = relevantChanges(event.changelog?.items);
    if (changes.length === 0) return;
    const promises = await promisesForDevItem(key);
    if (promises.length === 0) return;

    const sprintIds = changes.filter((c) => c.field === 'sprint').flatMap((c) => [...addedSprintIds(c), ...removedSprintIds(c)]);
    const names = sprintIds.length > 0 ? await sprintNames(sprintIds) : {};
    const at = new Date().toISOString();
    const who = await actorName(event);
    const evidence: ChangeEvidence[] = changes.filter((c) => c.field !== 'assignee').map((c) => toEvidence(c, who, at, names));
    await evaluateDevItems([key], { [key]: evidence });
  } catch (e) {
    console.error(`Kept: issue event ${event.eventType} failed: ${(e as Error).message}`);
  }
}

interface LinkEvent {
  eventType: string;
  sourceIssueId: string;
  destinationIssueId: string;
}

async function keyOf(id: string): Promise<string | undefined> {
  const issue = await jiraGetOptional<{ key: string }>('app', route`/rest/api/3/issue/${id}?fields=summary`);
  return issue?.key;
}

export async function onLinkEvent(event: LinkEvent): Promise<void> {
  try {
    for (const id of [event.sourceIssueId, event.destinationIssueId]) {
      const key = await keyOf(id);
      if (!key) continue;
      if ((await promisesForRequest(key)).length > 0) await evaluateRequest(key);
    }
  } catch (e) {
    console.error(`Kept: link event failed: ${(e as Error).message}`);
  }
}

/** Re-evaluates every promised dev item matched by a JQL clause (sprint or release changes). */
async function reevaluateJql(jql: string, evidenceText?: string): Promise<void> {
  const issues = await searchIssues(jql, ['summary'], 200);
  const keys: string[] = [];
  for (const i of issues) if ((await promisesForDevItem(i.key)).length > 0) keys.push(i.key);
  if (keys.length === 0) return;
  const at = new Date().toISOString();
  const evidence: Record<string, ChangeEvidence[]> = {};
  if (evidenceText) for (const k of keys) evidence[k] = [{ field: 'plan', text: evidenceText, at }];
  await evaluateDevItems(keys, evidence);
}

interface SprintEvent {
  eventType: string;
  sprint: { id: number; name?: string; endDate?: string };
}

export async function onSprintEvent(event: SprintEvent): Promise<void> {
  try {
    const id = event.sprint?.id;
    if (!id) return;
    const what = event.eventType.includes('closed')
      ? `${event.sprint.name ?? 'The sprint'} was closed`
      : event.eventType.includes('started')
        ? undefined
        : `${event.sprint.name ?? 'The sprint'} dates changed`;
    await reevaluateJql(`sprint = ${Number(id)}`, what);
  } catch (e) {
    console.error(`Kept: sprint event failed: ${(e as Error).message}`);
  }
}

interface VersionEvent {
  eventType: string;
  version: { id: string | number; name?: string; releaseDate?: string };
}

export async function onVersionEvent(event: VersionEvent): Promise<void> {
  try {
    const id = event.version?.id;
    if (id === undefined) return;
    const name = event.version.name ?? 'The release';
    const what = event.eventType.includes(':released:')
      ? `Release ${name} was released`
      : event.eventType.includes(':unreleased:')
        ? `Release ${name} was marked unreleased`
        : `Release ${name} changed${event.version.releaseDate ? ` (date: ${String(event.version.releaseDate).slice(0, 10)})` : ''}`;
    await reevaluateJql(`fixVersion = ${Number(id)}`, what);
  } catch (e) {
    console.error(`Kept: version event failed: ${(e as Error).message}`);
  }
}

export async function onSchedule(): Promise<void> {
  try {
    const r = await sweepAll();
    if (r.changed.length > 0) console.log(`Kept sweep: ${r.evaluated} checked, ${r.changed.length} changed, ${r.alerts.length} alerts`);
  } catch (e) {
    console.error(`Kept: sweep failed: ${(e as Error).message}`);
  }
}

export async function onLifecycle(): Promise<void> {
  try {
    await discoverFieldIds();
  } catch (e) {
    console.error(`Kept: setup failed: ${(e as Error).message}`);
  }
}

export { refreshProperties };
