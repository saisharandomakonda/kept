// Promise records in Forge custom entities (indexes are declared in manifest.yml under app.storage).
import { kvs, Sort, WhereConditions } from '@forge/kvs';
import type { PromiseRecord, PromiseState } from '../domain/types';

const ENTITY = 'promise';

function table() {
  return kvs.entity<PromiseRecord>(ENTITY);
}

async function all(builder: { getMany(): Promise<{ results: { value: PromiseRecord }[]; nextCursor?: string }>; cursor(c: string): unknown }, max: number) {
  const out: PromiseRecord[] = [];
  let page = await builder.getMany();
  out.push(...page.results.map((r) => r.value));
  while (page.nextCursor && out.length < max) {
    builder.cursor(page.nextCursor);
    page = await builder.getMany();
    out.push(...page.results.map((r) => r.value));
  }
  return out.slice(0, max);
}

export async function getPromise(id: string): Promise<PromiseRecord | undefined> {
  return table().get(id);
}

export async function savePromise(p: PromiseRecord): Promise<PromiseRecord> {
  const trimmed: PromiseRecord = { ...p, history: p.history.slice(-50), updatedAt: new Date().toISOString() };
  await table().set(p.id, trimmed);
  return trimmed;
}

export async function deletePromise(id: string): Promise<void> {
  await table().delete(id);
}

export async function promisesForRequest(requestKey: string): Promise<PromiseRecord[]> {
  const q = table().query().index('by-request', { partition: [requestKey] }).sort(Sort.ASC).limit(50);
  return all(q, 200);
}

export async function promisesForDevItem(devIssueKey: string): Promise<PromiseRecord[]> {
  const q = table().query().index('by-dev', { partition: [devIssueKey] }).sort(Sort.ASC).limit(50);
  return all(q, 500);
}

/** Promises in a state, optionally with a promised date in [from, to]. */
export async function promisesByState(state: PromiseState, from?: string, to?: string, max = 1000): Promise<PromiseRecord[]> {
  let q = table().query().index('by-state', { partition: [state] }).sort(Sort.ASC).limit(100);
  if (from || to) q = q.where(WhereConditions.between(from ?? '0000-01-01', to ?? '9999-12-31'));
  return all(q, max);
}

export async function promisesByProjectState(projectKey: string, state: PromiseState, max = 1000): Promise<PromiseRecord[]> {
  const q = table().query().index('by-project-state', { partition: [projectKey, state] }).sort(Sort.ASC).limit(100);
  return all(q, max);
}

export const LIVE_STATES: PromiseState[] = ['open', 'suggested'];
export const ALL_STATES: PromiseState[] = ['suggested', 'open', 'kept', 'kept-late', 'broken', 'withdrawn', 'replaced'];
