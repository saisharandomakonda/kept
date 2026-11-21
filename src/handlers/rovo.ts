// Rovo actions for the Kept agent. Inputs come from an LLM, so everything is validated. Reads are made
// as the signed-in person or filtered to the spaces they can browse.
import { daysBetween, isIsoDate } from '../domain/dates';
import { detectCommitments } from '../domain/detect';
import { RISK_STYLE } from '../domain/labels';
import type { PromiseRecord } from '../domain/types';
import { listComments } from '../jira/comments';
import { getRequest } from '../jira/issues';
import { canSeeWorkItem } from '../jira/permissions';
import { isServiceSpace } from '../jira/projects';
import { isCustomerAccount } from '../jira/users';
import { dashboard, devView, requestView } from '../services/chain';
import { today } from '../services/clock';
import { looksInternal } from '../domain/draft';
import { tellCustomer, trackPromise, UserError } from '../services/promises';

interface ActionPayload {
  requestKey?: string;
  days?: number | string;
  projectKey?: string;
  promisedDate?: string;
  promiseText?: string;
  devIssueKey?: string;
  message?: string;
  newPromisedDate?: string;
  context?: { jira?: { issueKey?: string; projectKey?: string } };
}

interface ActionContext {
  accountId?: string;
  principal?: { accountId?: string };
}

const KEY = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/;

function resolveKey(p: ActionPayload): string {
  const raw = (p.requestKey ?? p.context?.jira?.issueKey ?? '').trim().toUpperCase();
  if (!raw) throw new UserError('Which request? Open a request or give its key, for example SUP-12.');
  if (!KEY.test(raw)) throw new UserError(`"${raw}" doesn't look like a work item key (for example SUP-12).`);
  return raw;
}

function accountOf(ctx?: ActionContext): string | undefined {
  return ctx?.principal?.accountId ?? ctx?.accountId;
}

async function safely<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    console.error(`Kept Rovo action failed: ${(e as Error).stack ?? e}`);
    return { error: 'Kept could not complete that. Try again in a moment.' };
  }
}

function brief(p: PromiseRecord, day: string) {
  return {
    promiseId: p.id,
    customer: p.customer,
    state: p.state,
    status: RISK_STYLE[p.risk].label,
    promisedDate: p.promisedDate,
    daysUntilPromise: daysBetween(day, p.promisedDate),
    expectedFixDate: p.expectedDate ?? null,
    expectedFrom: p.expectedSource ?? null,
    whatWasPromised: p.text || null,
    reasons: p.reasons.map((r) => r.message),
    dependsOn: p.devIssueKey ?? null,
    customerLastUpdated: p.customerToldAt ?? null,
    recentHistory: p.history.slice(-4).map((h) => `${h.at.slice(0, 10)}: ${h.text}`),
  };
}

export async function getPromiseContext(payload: ActionPayload, _ctx?: ActionContext) {
  return safely(async () => {
    const key = resolveKey(payload);
    const projectKey = key.split('-')[0] as string;
    const day = today();
    if (!(await isServiceSpace(projectKey))) {
      // A developer work item: who is waiting on it?
      if (!(await canSeeWorkItem(key))) throw new UserError(`Work item ${key} was not found, or you can't see it.`);
      const v = await devView(key);
      return {
        workItem: key,
        kind: 'developer work item',
        customersWaiting: v.waiting,
        promisesAtRisk: v.atRisk,
        promises: v.promises.map((p) => ({ request: p.requestKey, ...brief(p, day) })),
      };
    }
    const v = await requestView(key);
    if (!v.found) throw new UserError(`Request ${key} was not found, or you can't see it.`);
    return {
      today: day,
      request: { key: v.request.key, summary: v.request.summary, status: v.request.status, customer: v.request.customer, reporter: v.request.reporterName },
      developerWork: v.devItems.map((d) => ({ key: d.key, summary: d.summary, status: d.status, plan: d.plan, assignee: d.assignee ?? 'Unassigned' })),
      promises: v.promises.filter((p) => p.state !== 'withdrawn').map((p) => brief(p, day)),
      guidance:
        'For customer messages: be honest and specific, apologise once if a date moved, and never include work item keys, sprint or release names, or people.',
    };
  });
}

export async function listPromisesAtRisk(payload: ActionPayload) {
  return safely(async () => {
    const days = Math.min(Math.max(Number(payload.days ?? 7) || 7, 1), 90);
    const projectKey = payload.projectKey?.trim().toUpperCase() || undefined;
    const d = await dashboard(projectKey);
    const rows = d.rows.filter((r) => r.risk === 'at-risk' || r.risk === 'broken' || r.risk === 'tight' || r.daysLeft <= days);
    return {
      today: d.today,
      window: `next ${days} days`,
      summary: { open: d.counts.open, atRisk: d.counts.atRisk, broken: d.counts.broken, keptOnTimePercent: d.counts.keptRate },
      promises: rows.slice(0, 25).map((r) => ({
        request: r.requestKey,
        customer: r.customer,
        promisedDate: r.promisedDate,
        daysUntilPromise: r.daysLeft,
        expectedFixDate: r.expectedDate ?? null,
        status: RISK_STYLE[r.risk].label,
        why: r.why,
        customerLastUpdated: r.customerToldAt ?? null,
      })),
    };
  });
}

export async function findPromisesInRequest(payload: ActionPayload) {
  return safely(async () => {
    const key = resolveKey(payload);
    const request = await getRequest(key, 'user');
    if (!request) throw new UserError(`Request ${key} was not found, or you can't see it.`);
    // Only agents make promises: skip replies written by customers (portal-only accounts).
    const comments = (await listComments(key, 'user', 50)).filter((c) => c.isPublic && !/Posted by Kept/.test(c.text));
    const fromCustomer = await Promise.all(comments.map((c) => isCustomerAccount(c.authorId)));
    const replies = comments.filter((_, i) => !fromCustomer[i]).slice(0, 15);
    const v = await requestView(key);
    const tracked = v.found ? v.promises.filter((p) => p.state === 'open' || p.state === 'suggested').map((p) => p.promisedDate) : [];
    return {
      request: key,
      alreadyTracked: tracked,
      replies: replies.map((r) => ({
        date: r.date,
        author: r.authorName,
        text: r.text.slice(0, 800),
        ruleBasedCandidates: detectCommitments(r.text, r.date).map((d) => ({ date: d.date ?? null, quote: d.sentence, confidence: d.confidence })),
      })),
      instructions: 'Confirm any new promise with the user (date in YYYY-MM-DD and the quoted sentence) before calling track-promise.',
    };
  });
}

export async function trackPromiseAction(payload: ActionPayload, ctx?: ActionContext) {
  return safely(async () => {
    const key = resolveKey(payload);
    const date = (payload.promisedDate ?? '').trim();
    if (!isIsoDate(date)) throw new UserError('promisedDate must be a date in YYYY-MM-DD form.');
    const p = await trackPromise({
      requestKey: key,
      promisedDate: date,
      text: payload.promiseText,
      devIssueKey: payload.devIssueKey,
      source: 'rovo',
      accountId: accountOf(ctx),
      actor: 'user',
    });
    return { tracked: true, ...brief(p, today()) };
  });
}

export async function postCustomerUpdate(payload: ActionPayload, ctx?: ActionContext) {
  return safely(async () => {
    const key = resolveKey(payload);
    const newDate = payload.newPromisedDate?.trim() || undefined;
    if (newDate && !isIsoDate(newDate)) throw new UserError('newPromisedDate must be a date in YYYY-MM-DD form.');
    if (looksInternal(payload.message ?? '')) {
      throw new UserError('The message mentions internal details (a work item key, sprint, backlog or Jira). Rewrite it for the customer, then try again.');
    }
    const r = await tellCustomer({ requestKey: key, message: payload.message ?? '', newDate, accountId: accountOf(ctx) });
    return {
      sent: true,
      request: key,
      newPromise: r.newPromise ? brief(r.newPromise, today()) : null,
    };
  });
}
