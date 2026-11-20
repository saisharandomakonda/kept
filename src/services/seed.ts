// The sample scenario: one click builds a small, realistic support ↔ engineering story in the
// spaces the admin picks, with dates relative to today. Everything created is recorded so
// "Remove sample data" deletes exactly that and nothing else.
//
// It runs as a series of short steps driven by the UI (each well under the 25 s limit) and as
// the signed-in admin, so every work item shows a real person as its author.
import { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { addDays, formatDateWithDay } from '../domain/dates';
import type { PromiseRecord } from '../domain/types';
import { addCustomerReply } from '../jira/comments';
import { jiraGet, jiraSend } from '../jira/http';
import { createRelease, createSprint, scrumBoards, updateSprint, moveToSprint } from '../jira/projects';
import { deletePromise, promisesForRequest } from '../store/promises';
import { today } from './clock';
import { refreshProperties } from './evaluate';
import { trackPromise, UserError } from './promises';

const STATUS_KEY = 'sample:status:v1';
export const SAMPLE_LABEL = 'kept-sample';

export interface SampleStatus {
  state: 'idle' | 'running' | 'done' | 'failed' | 'removing';
  step: number;
  total: number;
  message: string;
  serviceKey?: string;
  devKey?: string;
  startedAt?: string;
  plan?: SamplePlan;
  created: { issues: string[]; sprints: number[]; versions: string[] };
  error?: string;
}

interface SamplePlan {
  day: string;
  serviceDeskId: string;
  requestTypeId: string;
  devProjectId: string;
  devIssueTypeId: string;
  boardId?: number;
  sprintA?: number;
  sprintB?: number;
  sprintAName: string;
  sprintBName: string;
  v23?: string;
  v24?: string;
  v23Name: string;
  v24Name: string;
  devs: string[];
  requests: string[];
}

// The five stories. Offsets are days from today.
const STORIES = [
  {
    customer: 'Acme Corp',
    request: 'Invoice export fails for our large accounts',
    requestText: 'Exporting invoices to PDF times out for our biggest accounts. Our finance team needs these for month-end close.',
    dev: 'Invoice PDF export times out for invoices over 500 lines',
    devStatus: 'indeterminate',
    sprint: 'A',
    release: '2.4',
    promiseOffset: 12,
    reply: (d: string, rel: string) =>
      `Thanks for the logs, they helped us find the cause. The fix is scheduled for release ${rel}, so we expect you to have it by ${d}.`,
    track: true,
  },
  {
    customer: 'Globex',
    request: "We can't sign in with SSO on Safari",
    requestText: 'Since this week, our staff on Safari get stuck in a login loop when signing in with SSO.',
    dev: 'SSO sign-in loops on Safari 18',
    devStatus: 'new',
    sprint: 'A',
    release: undefined,
    promiseOffset: 10,
    reply: (d: string) => `We've reproduced the login loop. We expect the fix to be live by ${d}.`,
    track: true,
  },
  {
    customer: 'Initech',
    request: 'Customer names look garbled after CSV import',
    requestText: 'After importing our customer list, names with accents (José, Zoë) show strange characters.',
    dev: 'CSV import drops accented characters in names',
    devStatus: 'new',
    sprint: undefined,
    release: undefined,
    promiseOffset: 7,
    reply: (d: string) => `Thanks for the examples. We will have this fixed by ${d}.`,
    track: true,
  },
  {
    customer: 'Umbrella',
    request: 'Webhook storm is hammering our API',
    requestText: 'Your webhooks retried thousands of times in a few minutes and hit our rate limits.',
    dev: 'Webhook retries ignore exponential backoff',
    devStatus: 'done',
    sprint: undefined,
    release: '2.3',
    promiseOffset: -1,
    reply: (d: string) => `We've identified the retry problem. The fix will be released by ${d}.`,
    followUp: (_d: string) => 'Good news: the fix for the webhook retries has been released. Could you confirm things look normal on your side now?',
    track: true,
  },
  {
    customer: 'Hooli',
    request: "Search doesn't show archived work",
    requestText: 'When we search, nothing from archived spaces shows up, even with the archived filter on.',
    dev: 'Search excludes items from archived spaces',
    devStatus: 'indeterminate',
    sprint: 'B',
    release: undefined,
    promiseOffset: undefined,
    reply: () => "Good news: the team has picked this up, and we're aiming to ship the fix by the end of next week.",
    track: false,
  },
] as const;

const STEPS = ['Checking your spaces', 'Creating releases', 'Creating sprints', 'Creating developer work items', 'Creating customer requests', 'Linking requests to work items', 'Tracking promises', 'Posting replies to customers'];

const empty = (): SampleStatus => ({ state: 'idle', step: 0, total: STEPS.length, message: '', created: { issues: [], sprints: [], versions: [] } });

export async function sampleStatus(): Promise<SampleStatus> {
  return (await kvs.get<SampleStatus>(STATUS_KEY)) ?? empty();
}

async function save(s: SampleStatus): Promise<SampleStatus> {
  await kvs.set(STATUS_KEY, s);
  return s;
}

export async function startSample(input: { serviceKey: string; devKey: string; accountId?: string }): Promise<SampleStatus> {
  const current = await sampleStatus();
  if (current.state === 'running') return current;
  if (current.state === 'done' && current.created.issues.length > 0) {
    throw new UserError('A sample scenario already exists. Remove it first.');
  }
  if (!input.serviceKey || !input.devKey) throw new UserError('Pick a service space and a software space.');
  return save({
    ...empty(),
    state: 'running',
    message: STEPS[0] as string,
    serviceKey: input.serviceKey,
    devKey: input.devKey,
    startedAt: new Date().toISOString(),
  });
}

/** Runs the next step. The UI calls this until state is "done" or "failed". */
export async function sampleStep(): Promise<SampleStatus> {
  const s = await sampleStatus();
  if (s.state !== 'running') return s;
  try {
    await STEP_FNS[s.step]?.(s);
    s.step += 1;
    if (s.step >= STEPS.length) {
      s.state = 'done';
      s.message = 'Sample scenario ready';
    } else {
      s.message = STEPS[s.step] as string;
    }
  } catch (e) {
    s.state = 'failed';
    s.error = e instanceof UserError ? e.message : `${STEPS[s.step]} failed: ${(e as Error).message.slice(0, 300)}`;
    console.error(`Kept sample step ${s.step} failed: ${(e as Error).stack ?? e}`);
  }
  return save(s);
}

// ---------------- steps ----------------

const plan = (s: SampleStatus) => s.plan as SamplePlan;

async function prepare(s: SampleStatus) {
  const devKey = s.devKey as string;
  const desks = await jiraGet<{ values: { id: string; projectKey: string }[] }>('user', route`/rest/servicedeskapi/servicedesk?limit=100`);
  const desk = desks.values.find((d) => d.projectKey === s.serviceKey);
  if (!desk) throw new UserError(`${s.serviceKey} isn't a service space you can use.`);
  const types = await jiraGet<{ values: { id: string; name: string }[] }>(
    'user',
    route`/rest/servicedeskapi/servicedesk/${desk.id}/requesttype?limit=100`
  );
  let requestTypeId: string | undefined;
  const preferred = [...types.values].sort((a, b) => score(b.name) - score(a.name));
  for (const t of preferred) {
    const fields = await jiraGet<{ requestTypeFields: { fieldId: string; required: boolean }[] }>(
      'user',
      route`/rest/servicedeskapi/servicedesk/${desk.id}/requesttype/${t.id}/field`
    );
    if (fields.requestTypeFields.filter((f) => f.required).every((f) => f.fieldId === 'summary' || f.fieldId === 'description')) {
      requestTypeId = t.id;
      break;
    }
  }
  if (!requestTypeId) throw new UserError(`No request type in ${s.serviceKey} can be created with just a summary and description.`);

  const project = await jiraGet<{ id: string; issueTypes: { id: string; name: string; subtask: boolean }[] }>(
    'user',
    route`/rest/api/3/project/${devKey}`
  );
  const issueType =
    project.issueTypes.find((t) => t.name === 'Bug') ??
    project.issueTypes.find((t) => t.name === 'Task') ??
    project.issueTypes.find((t) => !t.subtask);
  if (!issueType) throw new UserError(`${devKey} has no usable work type.`);

  const boards = await scrumBoards(devKey, 'user').catch(() => []);
  const versions = await jiraGet<{ name: string }[]>('user', route`/rest/api/3/project/${devKey}/versions`);
  const taken = new Set(versions.map((v) => v.name));
  const free = (name: string) => (taken.has(name) ? `${name} (sample)` : name);

  s.plan = {
    day: today(),
    serviceDeskId: desk.id,
    requestTypeId,
    devProjectId: project.id,
    devIssueTypeId: issueType.id,
    boardId: boards[0]?.id,
    sprintAName: 'Sprint 14',
    sprintBName: 'Sprint 15',
    v23Name: free('v2.3'),
    v24Name: free('v2.4'),
    devs: [],
    requests: [],
  };
}

function score(name: string): number {
  if (/bug|problem|system issue/i.test(name)) return 3;
  if (/report|issue|help/i.test(name)) return 2;
  if (/question/i.test(name)) return 1;
  return 0;
}

async function releases(s: SampleStatus) {
  const p = plan(s);
  const v23 = await createRelease(p.devProjectId, p.v23Name, addDays(p.day, -2), true);
  s.created.versions.push(v23.id);
  p.v23 = v23.id;
  const v24 = await createRelease(p.devProjectId, p.v24Name, addDays(p.day, 10), false);
  s.created.versions.push(v24.id);
  p.v24 = v24.id;
}

async function sprints(s: SampleStatus) {
  const p = plan(s);
  if (!p.boardId) return; // No Scrum board: the scenario uses releases and due dates instead.
  const existing = await jiraGet<{ values: { name: string; state: string }[] }>(
    'user',
    route`/rest/agile/1.0/board/${String(p.boardId)}/sprint?maxResults=50`
  ).catch(() => ({ values: [] as { name: string; state: string }[] }));
  const names = new Set(existing.values.map((x) => x.name));
  if (names.has(p.sprintAName)) p.sprintAName = `${p.sprintAName} (sample)`;
  if (names.has(p.sprintBName)) p.sprintBName = `${p.sprintBName} (sample)`;
  const a = await createSprint(p.boardId, p.sprintAName, addDays(p.day, -5), addDays(p.day, 9));
  s.created.sprints.push(a.id);
  p.sprintA = a.id;
  const b = await createSprint(p.boardId, p.sprintBName, addDays(p.day, 9), addDays(p.day, 23));
  s.created.sprints.push(b.id);
  p.sprintB = b.id;
  if (!existing.values.some((x) => x.state === 'active')) {
    await updateSprint(a.id, {
      state: 'active',
      startDate: `${addDays(p.day, -5)}T09:00:00.000Z`,
      endDate: `${addDays(p.day, 9)}T17:00:00.000Z`,
    }).catch((e) => console.warn(`Kept sample: could not start sprint: ${(e as Error).message}`));
  }
}

async function transitionTo(key: string, category: string) {
  const res = await jiraGet<{ transitions: { id: string; to: { statusCategory: { key: string } } }[] }>(
    'user',
    route`/rest/api/3/issue/${key}/transitions`
  );
  const t = res.transitions.find((x) => x.to.statusCategory.key === category);
  if (t) await jiraSend('user', 'POST', route`/rest/api/3/issue/${key}/transitions`, { transition: { id: t.id } });
}

async function devItems(s: SampleStatus) {
  const p = plan(s);
  for (const story of STORIES) {
    const fixVersions = story.release === '2.4' && p.v24 ? [{ id: p.v24 }] : story.release === '2.3' && p.v23 ? [{ id: p.v23 }] : [];
    const created = await jiraSend<{ key: string }>('user', 'POST', route`/rest/api/3/issue`, {
      fields: {
        project: { id: p.devProjectId },
        issuetype: { id: p.devIssueTypeId },
        summary: story.dev,
        labels: [SAMPLE_LABEL],
        ...(fixVersions.length ? { fixVersions } : {}),
      },
    });
    const key = (created as { key: string }).key;
    s.created.issues.push(key);
    p.devs.push(key);
    if (story.sprint === 'A' && p.sprintA) await moveToSprint(p.sprintA, [key]).catch(() => undefined);
    if (story.sprint === 'B' && p.sprintB) await moveToSprint(p.sprintB, [key]).catch(() => undefined);
    if (!p.boardId && story.sprint) {
      // No sprints on this site: use a due date with the same meaning.
      const due = addDays(p.day, story.sprint === 'A' ? 9 : 23);
      await jiraSend('user', 'PUT', route`/rest/api/3/issue/${key}`, { fields: { duedate: due } });
    }
    if (story.devStatus !== 'new') await transitionTo(key, story.devStatus);
  }
}

async function requests(s: SampleStatus) {
  const p = plan(s);
  for (const story of STORIES) {
    const r = await jiraSend<{ issueKey: string }>('user', 'POST', route`/rest/servicedeskapi/request`, {
      serviceDeskId: p.serviceDeskId,
      requestTypeId: p.requestTypeId,
      requestFieldValues: { summary: story.request, description: `${story.requestText}\n\n(Sample scenario created by Kept for ${story.customer}.)` },
    });
    const key = (r as { issueKey: string }).issueKey;
    s.created.issues.push(key);
    p.requests.push(key);
    await jiraSend('user', 'PUT', route`/rest/api/3/issue/${key}`, { update: { labels: [{ add: SAMPLE_LABEL }] } }).catch(() => undefined);
  }
}

async function links(s: SampleStatus) {
  const p = plan(s);
  for (let i = 0; i < STORIES.length; i++) {
    await jiraSend('user', 'POST', route`/rest/api/3/issueLink`, {
      type: { name: 'Relates' },
      inwardIssue: { key: p.requests[i] },
      outwardIssue: { key: p.devs[i] },
    });
  }
}

async function promises(s: SampleStatus) {
  const p = plan(s);
  for (let i = 0; i < STORIES.length; i++) {
    const story = STORIES[i]!;
    if (!story.track || story.promiseOffset === undefined) continue;
    const date = addDays(p.day, story.promiseOffset);
    await trackPromise({
      requestKey: p.requests[i] as string,
      devIssueKey: p.devs[i],
      promisedDate: date,
      text: story.reply(formatDateWithDay(date, p.day), p.v24Name),
      customer: story.customer,
      source: 'sample',
      actor: 'user',
    });
  }
}

async function replies(s: SampleStatus) {
  const p = plan(s);
  for (let i = 0; i < STORIES.length; i++) {
    const story = STORIES[i]!;
    const date = story.promiseOffset !== undefined ? addDays(p.day, story.promiseOffset) : p.day;
    await addCustomerReply(p.requests[i] as string, `Hi,\n\n${story.reply(formatDateWithDay(date, p.day), p.v24Name)}\n\nThanks,\nSupport team`);
  }
}

const STEP_FNS: ((s: SampleStatus) => Promise<void>)[] = [prepare, releases, sprints, devItems, requests, links, promises, replies];

/** Deletes exactly what the sample created: work items, sprints, releases and their promises. */
export async function removeSample(): Promise<SampleStatus> {
  const s = await sampleStatus();
  if (s.state === 'running') throw new UserError('The sample scenario is still being created. Wait for it to finish.');
  const problems: string[] = [];
  for (const key of s.created.issues) {
    for (const pr of await promisesForRequest(key).catch(() => [] as PromiseRecord[])) await deletePromise(pr.id);
  }
  for (const key of [...s.created.issues].reverse()) {
    await jiraSend('user', 'DELETE', route`/rest/api/3/issue/${key}?deleteSubtasks=true`).catch((e) => problems.push(`${key}: ${(e as Error).message.slice(0, 80)}`));
  }
  for (const id of s.created.sprints) {
    await jiraSend('user', 'POST', route`/rest/agile/1.0/sprint/${String(id)}`, { state: 'closed' }).catch(() => undefined);
    await jiraSend('user', 'DELETE', route`/rest/agile/1.0/sprint/${String(id)}`).catch(() => undefined);
  }
  for (const id of s.created.versions) {
    await jiraSend('user', 'DELETE', route`/rest/api/3/version/${id}`).catch((e) => problems.push(`release ${id}: ${(e as Error).message.slice(0, 80)}`));
  }
  await refreshProperties([], []);
  const next = empty();
  if (problems.length) next.error = `Some items could not be removed: ${problems.slice(0, 3).join('; ')}`;
  return save(next);
}
