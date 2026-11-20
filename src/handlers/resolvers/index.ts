// Backend for every UI Kit screen. Each call checks who is asking and what they may see.
import Resolver from '@forge/resolver';
import { route } from '@forge/api';
import { addDays, isIsoDate } from '../../domain/dates';
import { draftCustomerUpdate } from '../../domain/draft';
import { RISK_STYLE } from '../../domain/labels';
import { worstRisk } from '../../domain/risk';
import type { RiskLevel } from '../../domain/types';
import { jiraGet } from '../../jira/http';
import { listSpaces, scrumBoards } from '../../jira/projects';
import { dashboard, devView, requestView } from '../../services/chain';
import { today } from '../../services/clock';
import { evaluateRequest } from '../../services/evaluate';
import { acceptSuggestion, closePromise, tellCustomer, trackPromise, UserError } from '../../services/promises';
import { promisesForDevItem, promisesForRequest } from '../../store/promises';
import { getSettings, saveSettings } from '../../store/settings';
import { removeSample, sampleStatus, sampleStep, startSample } from '../../services/seed';
import { portalForRequest } from '../../services/portal';

type Ctx = {
  accountId?: string;
  moduleKey?: string;
  extension?: {
    issue?: { key?: string };
    project?: { key?: string };
    request?: { key?: string };
    type?: string;
  };
};

type Handler = (payload: Record<string, unknown>, context: Ctx) => Promise<unknown>;

const resolver = new Resolver();

/** Wraps a handler: user mistakes come back as { error }, anything else is logged. */
function define(name: string, fn: Handler) {
  resolver.define(name, async ({ payload, context }) => {
    try {
      return { ok: true, data: await fn((payload ?? {}) as Record<string, unknown>, context as Ctx) };
    } catch (e) {
      if (e instanceof UserError) return { ok: false, error: e.message };
      console.error(`Kept resolver ${name} failed: ${(e as Error).stack ?? e}`);
      return { ok: false, error: 'Something went wrong. Try again, and check the app logs if it keeps happening.' };
    }
  });
}

function issueKey(ctx: Ctx): string {
  const key = ctx.extension?.issue?.key;
  if (!key) throw new UserError('Open this from a work item.');
  return key;
}

function str(v: unknown, max = 500): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
}

function date(v: unknown): string | undefined {
  const s = str(v, 10);
  if (s === undefined) return undefined;
  if (!isIsoDate(s)) throw new UserError('Pick a valid date.');
  return s;
}

async function requireAdmin(): Promise<void> {
  const res = await jiraGet<{ permissions: Record<string, { havePermission: boolean }> }>(
    'user',
    route`/rest/api/3/mypermissions?permissions=ADMINISTER`
  );
  if (!res.permissions?.ADMINISTER?.havePermission) throw new UserError('Only Jira admins can change Kept settings.');
}

async function myName(): Promise<string | undefined> {
  try {
    return (await jiraGet<{ displayName: string }>('user', route`/rest/api/3/myself`)).displayName;
  } catch {
    return undefined;
  }
}

// ---------- Customer promises panel (service requests) ----------
define('requestView', async (_p, ctx) => requestView(issueKey(ctx)));

define('trackPromise', async (p, ctx) =>
  trackPromise({
    requestKey: issueKey(ctx),
    promisedDate: date(p.promisedDate) ?? '',
    text: str(p.text),
    devIssueKey: str(p.devIssueKey, 30),
    customer: str(p.customer, 120),
    source: 'manual',
    accountId: ctx.accountId,
  })
);

define('acceptSuggestion', async (p, ctx) => acceptSuggestion(str(p.id, 64) ?? '', ctx.accountId, date(p.promisedDate)));
define('dismissPromise', async (p, ctx) => closePromise(str(p.id, 64) ?? '', 'withdrawn', ctx.accountId));
define('recheck', async (_p, ctx) => evaluateRequest(issueKey(ctx)));

define('draftUpdate', async (p, ctx) => {
  const key = issueKey(ctx);
  const view = await requestView(key);
  if (!view.found) throw new UserError('Request not found.');
  const open = view.promises.filter((x) => x.state === 'open');
  const focus = [...open].sort((a, b) => b.riskRank - a.riskRank)[0];
  if (!focus) throw new UserError('Track a promise first, then Kept can draft the update.');
  const day = today();
  const suggestedDate =
    focus.expectedDate && focus.expectedDate > focus.promisedDate ? addDays(focus.expectedDate, 1) : undefined;
  const newDate = date(p.newDate) ?? (focus.risk === 'at-risk' || focus.risk === 'broken' ? suggestedDate : undefined);
  return {
    newDate,
    suggestedDate,
    risk: focus.risk,
    text: draftCustomerUpdate({
      customerName: view.request.reporterName,
      topic: view.request.summary,
      risk: focus.risk,
      promisedDate: focus.promisedDate,
      newDate,
      deliveredAt: focus.expectedDate,
      agentName: await myName(),
      today: day,
    }),
  };
});

define('sendUpdate', async (p, ctx) =>
  tellCustomer({ requestKey: issueKey(ctx), message: str(p.message, 5000) ?? '', newDate: date(p.newDate), accountId: ctx.accountId })
);

// ---------- Customers waiting panel (dev work items) ----------
define('devView', async (_p, ctx) => devView(issueKey(ctx)));

// ---------- Promises page (global page + JSM queue page) ----------
define('dashboard', async (p, ctx) => dashboard(str(p.projectKey, 20) ?? ctx.extension?.project?.key));

// ---------- Customer portal ----------
define('portalView', async (_p, ctx) => {
  const key = ctx.extension?.request?.key;
  if (!key) return null;
  return portalForRequest(key);
});

// ---------- Settings + sample scenario (admins) ----------
define('getSettings', async () => getSettings());
define('saveSettings', async (p) => {
  await requireAdmin();
  return saveSettings(p as never);
});
define('spaces', async () => {
  const spaces = await listSpaces('user');
  return {
    service: spaces.filter((s) => s.type === 'service_desk'),
    software: spaces.filter((s) => s.type === 'software'),
  };
});
define('boards', async (p) => scrumBoards(str(p.projectKey, 20) ?? '', 'user'));
define('sampleStatus', async () => sampleStatus());
define('sampleStep', async () => {
  await requireAdmin();
  return sampleStep();
});
define('startSample', async (p, ctx) => {
  await requireAdmin();
  return startSample({
    serviceKey: str(p.serviceKey, 20) ?? '',
    devKey: str(p.devKey, 20) ?? '',
    accountId: ctx.accountId,
  });
});
define('removeSample', async () => {
  await requireAdmin();
  return removeSample();
});

export const handler = resolver.getDefinitions();
export { handler as resolver };

// ---------- Live status badges on the issue context panels ----------
export async function requestBadge(payload: { extension?: { issue?: { key?: string } } }) {
  const key = payload?.extension?.issue?.key;
  if (!key) return {};
  const promises = (await promisesForRequest(key)).filter((p) => p.state === 'open' || p.state === 'suggested');
  if (promises.length === 0) return { status: { type: 'lozenge', value: { label: 'None', type: 'default' } } };
  const open = promises.filter((p) => p.state === 'open');
  if (open.length === 0) return { status: { type: 'lozenge', value: { label: 'Suggested', type: 'new' } } };
  const risk = worstRisk(open.map((p) => p.risk)) as RiskLevel;
  return { status: { type: 'lozenge', value: { label: RISK_STYLE[risk].label, type: RISK_STYLE[risk].appearance } } };
}

export async function devBadge(payload: { extension?: { issue?: { key?: string } } }) {
  const key = payload?.extension?.issue?.key;
  if (!key) return {};
  const open = (await promisesForDevItem(key)).filter((p) => p.state === 'open');
  if (open.length === 0) return {};
  const atRisk = open.some((p) => p.risk === 'at-risk' || p.risk === 'broken');
  const n = new Set(open.map((p) => p.requestKey)).size;
  return { status: { type: 'lozenge', value: { label: `${n} waiting`, type: atRisk ? 'removed' : 'inprogress' } } };
}
