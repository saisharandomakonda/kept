// Commands on promises: track, accept or dismiss a suggestion, withdraw, tell the customer,
// and detect promises in new replies.
import { randomUUID } from 'node:crypto';
import { daysBetween, formatDateWithDay, isIsoDate } from '../domain/dates';
import { detectCommitments } from '../domain/detect';
import { nextRelease } from '../domain/expected';
import { RISK_RANK } from '../domain/risk';
import type { PromiseRecord } from '../domain/types';
import { addCustomerReply, getComment } from '../jira/comments';
import { getRequest } from '../jira/issues';
import { isServiceSpace } from '../jira/projects';
import { isCustomerAccount } from '../jira/users';
import { getPromise, promisesForRequest, savePromise } from '../store/promises';
import { getSettings } from '../store/settings';
import { devItemsOf } from './chain';
import { today } from './clock';
import { evaluatePromises, refreshProperties } from './evaluate';

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

export interface TrackInput {
  requestKey: string;
  promisedDate: string;
  text?: string;
  devIssueKey?: string;
  customer?: string;
  source: PromiseRecord['source'];
  sourceCommentId?: string;
  accountId?: string;
  state?: 'open' | 'suggested';
  /** 'user' checks the signed-in person can see the request (UI, Rovo). */
  actor?: 'user' | 'app';
}

export async function trackPromise(input: TrackInput): Promise<PromiseRecord> {
  if (!isIsoDate(input.promisedDate)) throw new UserError('The promised date must be a real date (YYYY-MM-DD).');
  const day = today();
  if (input.state !== 'suggested' && daysBetween(day, input.promisedDate) < -1) {
    throw new UserError('The promised date is in the past. Track promises that are still ahead.');
  }
  const request = await getRequest(input.requestKey, input.actor ?? 'user');
  if (!request) throw new UserError(`Request ${input.requestKey} was not found, or you can't see it.`);
  if (!(await isServiceSpace(request.projectKey))) {
    throw new UserError(`${request.key} isn't in a service space. Kept tracks promises on service requests.`);
  }
  const { items, snapshots } = await devItemsOf(request);
  let devIssueKey = input.devIssueKey?.trim().toUpperCase() || undefined;
  if (devIssueKey && !items.some((i) => i.key === devIssueKey)) {
    throw new UserError(`${devIssueKey} isn't linked to ${request.key}. Link the developer's work item first.`);
  }
  devIssueKey ??= items[0]?.key;

  const now = new Date().toISOString();
  const record: PromiseRecord = {
    id: randomUUID(),
    requestKey: request.key,
    requestId: request.id,
    projectKey: request.projectKey,
    devIssueKey,
    customer: (input.customer?.trim() || request.customer).slice(0, 120),
    promisedDate: input.promisedDate,
    text: (input.text ?? '').trim().slice(0, 500),
    source: input.source,
    sourceCommentId: input.sourceCommentId,
    madeBy: input.accountId,
    madeAt: now,
    state: input.state ?? 'open',
    risk: 'unknown',
    riskRank: RISK_RANK.unknown,
    reasons: [],
    history: [
      {
        at: now,
        type: input.state === 'suggested' ? 'suggested' : 'made',
        text:
          input.state === 'suggested'
            ? `Kept spotted a promise in a reply: ${formatDateWithDay(input.promisedDate, day)}.`
            : `Promise tracked: fix by ${formatDateWithDay(input.promisedDate, day)}.`,
        by: input.accountId,
      },
    ],
    updatedAt: now,
  };
  await savePromise(record);
  // Evaluate right away, quietly: the agent is looking at the result already.
  await evaluatePromises([record], { snapshots, quiet: true });
  const saved = (await getPromise(record.id)) ?? record;
  // Treat today's risk as already "seen" so only later slips raise an alert.
  if (saved.state === 'open') {
    saved.lastAlertedRisk = saved.risk;
    await savePromise(saved);
  }
  return saved;
}

async function load(id: string, requestKey?: string): Promise<PromiseRecord> {
  const p = await getPromise(id);
  if (!p || (requestKey && p.requestKey !== requestKey)) throw new UserError('That promise no longer exists.');
  // Permission: the signed-in user must be able to see the request.
  if (!(await getRequest(p.requestKey, 'user'))) throw new UserError("You can't see this request.");
  return p;
}

export async function acceptSuggestion(id: string, accountId?: string, promisedDate?: string): Promise<PromiseRecord> {
  const p = await load(id);
  if (p.state !== 'suggested') throw new UserError('This promise is already tracked.');
  if (promisedDate) {
    if (!isIsoDate(promisedDate)) throw new UserError('The promised date must be a real date.');
    p.promisedDate = promisedDate;
  }
  p.state = 'open';
  p.history.push({ at: new Date().toISOString(), type: 'accepted', text: 'Suggestion accepted: now tracking this promise.', by: accountId });
  await savePromise(p);
  await evaluatePromises([p], { quiet: true });
  const saved = (await getPromise(id)) ?? p;
  saved.lastAlertedRisk = saved.risk;
  return savePromise(saved);
}

export async function closePromise(id: string, state: 'withdrawn', accountId?: string): Promise<PromiseRecord> {
  const p = await load(id);
  p.history.push({
    at: new Date().toISOString(),
    type: 'withdrawn',
    text: p.state === 'suggested' ? 'Suggestion dismissed.' : 'Promise withdrawn.',
    by: accountId,
  });
  p.state = state;
  const saved = await savePromise(p);
  await refreshProperties([p.requestKey], p.devIssueKey ? [p.devIssueKey] : []);
  return saved;
}

export interface UpdateInput {
  requestKey: string;
  message: string;
  newDate?: string;
  accountId?: string;
}

/** Sends a reply to the customer (as the agent) and records it; optionally re-promises a new date. */
export async function tellCustomer(input: UpdateInput): Promise<{ commentId?: string; newPromise?: PromiseRecord }> {
  const message = input.message.trim();
  if (message.length < 10) throw new UserError('The message is too short to send.');
  if (message.length > 5000) throw new UserError('The message is too long (5,000 characters max).');
  if (input.newDate && !isIsoDate(input.newDate)) throw new UserError('The new date must be a real date.');
  const request = await getRequest(input.requestKey, 'user');
  if (!request) throw new UserError(`Request ${input.requestKey} was not found, or you can't see it.`);

  const commentId = await addCustomerReply(request.key, message);
  const now = new Date().toISOString();
  const promises = (await promisesForRequest(request.key)).filter((p) => p.state === 'open');
  const day = today();
  let newPromise: PromiseRecord | undefined;
  if (input.newDate) {
    const old = [...promises].sort((a, b) => b.riskRank - a.riskRank)[0];
    newPromise = await trackPromise({
      requestKey: request.key,
      promisedDate: input.newDate,
      text: old ? `Re-promised after the earlier date (${formatDateWithDay(old.promisedDate, day)}) moved.` : 'New date shared with the customer.',
      devIssueKey: old?.devIssueKey,
      customer: old?.customer,
      source: 'manual',
      accountId: input.accountId,
    });
    for (const p of old ? [old] : []) {
      p.state = 'replaced';
      p.replacedBy = newPromise.id;
      p.customerToldAt = now;
      p.history.push({ at: now, type: 're-promised', text: `Customer told; new date ${formatDateWithDay(input.newDate, day)}.`, by: input.accountId });
      await savePromise(p);
    }
    newPromise.replaces = old?.id;
    newPromise.customerToldAt = now;
    newPromise = await savePromise(newPromise);
  }
  for (const p of promises) {
    if (p.state !== 'open') continue;
    p.customerToldAt = now;
    p.history.push({ at: now, type: 'customer-told', text: 'Customer updated.', by: input.accountId });
    await savePromise(p);
  }
  await refreshProperties([request.key], [...new Set(promises.map((p) => p.devIssueKey).filter((k): k is string => !!k))]);
  return { commentId, newPromise };
}

/** Called for every new comment: suggests promises found in public replies by agents. */
export async function detectInReply(issueKey: string, commentId: string, customer?: string): Promise<PromiseRecord[]> {
  const settings = await getSettings();
  if (!settings.detectPromises) return [];
  const projectKey = issueKey.split('-')[0] ?? '';
  if (!(await isServiceSpace(projectKey))) return [];
  const [comment, request] = await Promise.all([getComment(issueKey, commentId), getRequest(issueKey, 'app')]);
  if (!comment || !request || !comment.isPublic) return [];
  // Customers writing "can you fix it by Friday?" aren't promises: only agents make promises.
  if (await isCustomerAccount(comment.authorId)) return [];
  if (/^Kept\b|Posted by Kept/i.test(comment.text)) return [];

  const found = detectCommitments(comment.text, comment.date);
  if (found.length === 0) return [];
  const { items, snapshots } = await devItemsOf(request);
  const existing = await promisesForRequest(issueKey);
  const created: PromiseRecord[] = [];
  for (const d of found.slice(0, 3)) {
    let date = d.date;
    if (!date && d.kind === 'release') {
      const dev = items[0] ? snapshots.get(items[0].key) : undefined;
      date = dev ? nextRelease(dev.fixVersions)?.releaseDate : undefined;
    }
    if (!date) continue;
    if (existing.some((p) => (p.state === 'open' || p.state === 'suggested') && p.promisedDate === date)) continue;
    created.push(
      await trackPromise({
        requestKey: issueKey,
        promisedDate: date,
        text: d.sentence,
        source: 'detected',
        sourceCommentId: commentId,
        accountId: comment.authorId,
        customer,
        state: 'suggested',
        actor: 'app',
      })
    );
  }
  if (created.length > 0) await refreshProperties([issueKey], []);
  console.log(`Kept detection on ${issueKey}: ${found.length} candidate(s), ${created.length} suggested`);
  return created;
}
