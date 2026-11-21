// End-to-end service tests against in-memory fakes of Jira and Forge storage.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addIssue, addProject, apiModule, jira, kvsModule, link, store } from '../mocks/fakes';

vi.mock('@forge/kvs', () => kvsModule);
vi.mock('@forge/api', () => apiModule);

const { trackPromise, tellCustomer, detectInReply, acceptSuggestion, UserError } = await import('../../src/services/promises');
const { evaluateDevItems, evaluateRequest, sweepAll } = await import('../../src/services/evaluate');
const { requestView, devView, dashboard } = await import('../../src/services/chain');
const { portalForRequest } = await import('../../src/services/portal');
const { onIssueEvent } = await import('../../src/handlers/triggers');
const { getPromiseContext, trackPromiseAction, listPromisesAtRisk } = await import('../../src/handlers/rovo');
const { requestBadge } = await import('../../src/handlers/resolvers');
const { saveSettings } = await import('../../src/store/settings');

vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-12-01T10:00:00Z'));
afterAll(() => vi.useRealTimers());

const status = (cat: 'new' | 'indeterminate' | 'done', name = cat === 'done' ? 'Done' : cat === 'new' ? 'To Do' : 'In Progress') => ({
  name,
  statusCategory: { key: cat },
});
const sprint14 = { id: 14, name: 'Sprint 14', state: 'active', endDate: '2026-12-09T17:00:00.000Z' };
const sprint15 = { id: 15, name: 'Sprint 15', state: 'future', endDate: '2026-12-23T17:00:00.000Z' };

function world() {
  store.reset();
  jira.reset();
  addProject('SUP', 'service_desk');
  addProject('BUG', 'software');
  jira.sprints.set(14, sprint14);
  jira.sprints.set(15, sprint15);
  addIssue('BUG-1', {
    summary: 'Invoice export times out',
    status: status('indeterminate'),
    fixVersions: [{ id: '24', name: 'v2.4', released: false, releaseDate: '2026-12-10' }],
    customfield_10020: [sprint14],
    assignee: { displayName: 'Dev Patel', accountId: 'dev-1' },
  });
  addIssue('SUP-1', {
    summary: 'Invoice export fails for large accounts',
    status: status('new', 'Waiting for support'),
    reporter: { displayName: 'Sam Lee', accountId: 'cust-1' },
    customfield_10002: [{ name: 'Acme Corp' }],
  });
  link('SUP-1', 'BUG-1');
}

beforeEach(world);

describe('tracking a promise', () => {
  it('links it to the dev work item and evaluates it right away, without an alert', async () => {
    const p = await trackPromise({ requestKey: 'SUP-1', promisedDate: '2026-12-12', text: 'Fix in v2.4', source: 'manual', accountId: 'agent-1' });
    expect(p).toMatchObject({ devIssueKey: 'BUG-1', customer: 'Acme Corp', state: 'open', risk: 'on-track', lastAlertedRisk: 'on-track' });
    expect(p.reasons[0]?.message).toBe('Release v2.4 ships Dec 10, 2 days before the promise (Dec 12).');
    expect(jira.posted('comment')).toHaveLength(0);
    expect(jira.issues.get('SUP-1')?.properties.kept).toMatchObject({ risk: 'on-track', promises: 1, promiseDate: '2026-12-12' });
    expect(jira.issues.get('BUG-1')?.properties.kept).toMatchObject({ waiting: 1, earliestPromise: '2026-12-12', atRisk: 0 });
  });

  it('rejects bad input with clear messages', async () => {
    await expect(trackPromise({ requestKey: 'SUP-1', promisedDate: '12/10', source: 'manual' })).rejects.toThrow(UserError);
    await expect(trackPromise({ requestKey: 'SUP-1', promisedDate: '2026-11-01', source: 'manual' })).rejects.toThrow(/in the past/);
    await expect(trackPromise({ requestKey: 'BUG-1', promisedDate: '2026-12-12', source: 'manual' })).rejects.toThrow(/isn't in a service space/);
    await expect(trackPromise({ requestKey: 'SUP-1', promisedDate: '2026-12-12', devIssueKey: 'BUG-9', source: 'manual' })).rejects.toThrow(/isn't linked/);
  });

  it('reuses the customer name agents already gave on this request', async () => {
    // A request without an organization: Jira only knows the reporter.
    addIssue('SUP-2', { summary: 'SSO fails', status: status('new'), reporter: { displayName: 'Sam Lee', accountId: 'cust-2' } });
    link('SUP-2', 'BUG-1');
    expect((await requestView('SUP-2')).request?.customer).toBe('Sam Lee');
    await trackPromise({ requestKey: 'SUP-2', promisedDate: '2026-12-12', customer: 'Hooli', source: 'manual' });
    expect((await requestView('SUP-2')).request?.customer).toBe('Hooli');
    // Re-promising with no open promise left (e.g. it was a suggestion) still keeps "Hooli".
    const second = await trackPromise({ requestKey: 'SUP-2', promisedDate: '2026-12-15', source: 'manual' });
    expect(second.customer).toBe('Hooli');
  });

  it("refuses requests the user can't see", async () => {
    jira.hiddenFromUser.add('SUP-1');
    await expect(trackPromise({ requestKey: 'SUP-1', promisedDate: '2026-12-12', source: 'manual' })).rejects.toThrow(/can't see it/);
  });
});

describe('the slip (the demo moment)', () => {
  it('turns the request red, posts one internal note and one dev heads-up, and updates JQL fields', async () => {
    await trackPromise({ requestKey: 'SUP-1', promisedDate: '2026-12-12', text: 'Fix in v2.4', source: 'manual' });

    // The developer drags BUG-1 into Sprint 15.
    jira.issues.get('BUG-1')!.fields.customfield_10020 = [sprint15];
    await onIssueEvent({
      eventType: 'avi:jira:updated:issue',
      issue: { id: '1', key: 'BUG-1' },
      atlassianId: 'dev-1',
      associatedUsers: [{ accountId: 'dev-1', displayName: 'Dev Patel' }],
      changelog: { items: [{ field: 'Sprint', fieldId: 'customfield_10020', from: '14', to: '15', fromString: null, toString: null }] },
    });

    const view = await requestView('SUP-1');
    expect(view.found && view.promises[0]).toMatchObject({ risk: 'at-risk', expectedDate: '2026-12-23' });
    const reasons = view.found ? view.promises[0]!.reasons.map((r) => r.message) : [];
    expect(reasons[0]).toBe('BUG-1 is in Sprint 15, which ends Dec 23, 11 days after the promised date (Dec 12).');
    expect(reasons).toContain('Moved from Sprint 14 to Sprint 15 by Dev Patel on Tue, Dec 1.');

    const notes = jira.posted('comment', 'SUP-1');
    expect(notes).toHaveLength(1);
    expect(notes[0]?.actor).toBe('app');
    expect(JSON.stringify(notes[0]?.body)).toContain('"internal":true');
    expect(JSON.stringify(notes[0]?.body)).toContain('At risk: promise to Acme Corp');
    const heads = jira.posted('comment', 'BUG-1');
    expect(heads).toHaveLength(1);
    expect(JSON.stringify(heads[0]?.body)).toContain('Acme Corp');

    expect(jira.issues.get('SUP-1')?.properties.kept).toMatchObject({ risk: 'at-risk', rank: 4 });
    expect(jira.issues.get('BUG-1')?.properties.kept).toMatchObject({ atRisk: 1 });
    expect(await requestBadge({ extension: { issue: { key: 'SUP-1' } } })).toEqual({
      status: { type: 'lozenge', value: { label: 'At risk', type: 'removed' } },
    });

    // A second, unrelated event must not repeat the alert.
    await evaluateDevItems(['BUG-1']);
    expect(jira.posted('comment', 'SUP-1')).toHaveLength(1);

    // Moving it back recovers quietly.
    jira.issues.get('BUG-1')!.fields.customfield_10020 = [sprint14];
    await evaluateDevItems(['BUG-1']);
    expect((await devView('BUG-1')).promises[0]?.risk).toBe('on-track');
    expect(jira.posted('comment', 'SUP-1')).toHaveLength(1);

    // A new slip a few minutes later is a new event: it must alert again (found on the live site).
    jira.issues.get('BUG-1')!.fields.fixVersions = [{ id: '24', name: 'v2.4', released: false, releaseDate: '2026-12-20' }];
    await evaluateDevItems(['BUG-1']);
    expect(jira.posted('comment', 'SUP-1')).toHaveLength(2);
  });

  it('respects the notification settings', async () => {
    await saveSettings({ noteOnRequest: false, noteOnDevIssue: false });
    await trackPromise({ requestKey: 'SUP-1', promisedDate: '2026-12-12', source: 'manual' });
    jira.issues.get('BUG-1')!.fields.customfield_10020 = [sprint15];
    await evaluateDevItems(['BUG-1']);
    expect(jira.posted('comment')).toHaveLength(0);
    expect(jira.issues.get('SUP-1')?.properties.kept).toMatchObject({ risk: 'at-risk' });
  });

  it('ignores changes to fields that cannot move a date', async () => {
    await trackPromise({ requestKey: 'SUP-1', promisedDate: '2026-12-12', source: 'manual' });
    const before = jira.calls.length;
    await onIssueEvent({ eventType: 'avi:jira:updated:issue', issue: { id: '1', key: 'BUG-1' }, changelog: { items: [{ field: 'summary', fieldId: 'summary' }] } });
    expect(jira.calls.length).toBe(before);
  });

  it('notices a dev item being unlinked', async () => {
    await trackPromise({ requestKey: 'SUP-1', promisedDate: '2026-12-12', source: 'manual' });
    jira.issues.get('SUP-1')!.fields.issuelinks = [];
    await evaluateRequest('SUP-1');
    const v = await requestView('SUP-1');
    expect(v.found && v.promises[0]).toMatchObject({ risk: 'unknown', devIssueKey: undefined });
  });

  it('the hourly sweep breaks a promise whose date passed', async () => {
    await trackPromise({ requestKey: 'SUP-1', promisedDate: '2026-12-12', source: 'manual' });
    vi.setSystemTime(new Date('2026-12-14T10:00:00Z'));
    const r = await sweepAll();
    expect(r.changed).toHaveLength(1);
    expect((await dashboard()).counts.broken).toBe(1);
    vi.setSystemTime(new Date('2026-12-01T10:00:00Z'));
  });
});

describe('telling the customer', () => {
  it('posts a public reply as the agent and re-promises a new date', async () => {
    const old = await trackPromise({ requestKey: 'SUP-1', promisedDate: '2026-12-12', source: 'manual' });
    const r = await tellCustomer({ requestKey: 'SUP-1', message: 'Hi Sam, honest update: the fix moved to Dec 24.', newDate: '2026-12-24' });
    const reply = jira.posted('comment', 'SUP-1')[0];
    expect(reply?.actor).toBe('user');
    expect(JSON.stringify(reply?.body)).toContain('"internal":false');
    expect(r.newPromise).toMatchObject({ promisedDate: '2026-12-24', state: 'open', replaces: old.id });
    const v = await requestView('SUP-1');
    const replaced = v.found ? v.promises.find((p) => p.id === old.id) : undefined;
    expect(replaced).toMatchObject({ state: 'replaced', replacedBy: r.newPromise?.id });
    expect(replaced?.customerToldAt).toBeTruthy();
  });

  it('rejects empty messages', async () => {
    await expect(tellCustomer({ requestKey: 'SUP-1', message: 'hi' })).rejects.toThrow(/too short/);
  });
});

describe('promise detection in replies', () => {
  it('suggests a promise from an agent reply, and Track turns it into a real one', async () => {
    jira.issues.get('SUP-1')!.comments.push({
      id: '77',
      author: { accountId: 'agent-1', displayName: 'Maya Chen' },
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'We expect the fix to be live by Dec 15.' }] }] },
      created: '2026-12-01T09:00:00.000+0000',
      jsdPublic: true,
    });
    const found = await detectInReply('SUP-1', '77');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ state: 'suggested', promisedDate: '2026-12-15', source: 'detected', text: 'We expect the fix to be live by Dec 15.' });
    expect(jira.posted('comment')).toHaveLength(0);

    // Running it twice doesn't duplicate.
    expect(await detectInReply('SUP-1', '77')).toHaveLength(0);

    const accepted = await acceptSuggestion(found[0]!.id, 'agent-1');
    expect(accepted).toMatchObject({ state: 'open', risk: 'on-track' });
  });

  it('resolves "next release" to the linked release date', async () => {
    jira.issues.get('SUP-1')!.comments.push({ id: '78', author: { accountId: 'agent-1', displayName: 'Maya' }, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'This will be fixed in the next release.' }] }] }, created: '2026-12-01T09:00:00.000+0000', jsdPublic: true });
    const found = await detectInReply('SUP-1', '78');
    expect(found[0]?.promisedDate).toBe('2026-12-10');
  });

  it('ignores the customer, internal notes, and turned-off detection', async () => {
    const text = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'We will fix it by Dec 15.' }] }] };
    jira.issues.get('SUP-1')!.comments.push(
      { id: '1', author: { accountId: 'cust-1', displayName: 'Sam' }, body: text, created: '2026-12-01T09:00:00.000+0000', jsdPublic: true },
      { id: '2', author: { accountId: 'agent-1', displayName: 'Maya' }, body: text, created: '2026-12-01T09:00:00.000+0000', jsdPublic: false },
      { id: '3', author: { accountId: 'agent-1', displayName: 'Maya' }, body: text, created: '2026-12-01T09:00:00.000+0000', jsdPublic: true }
    );
    expect(await detectInReply('SUP-1', '1')).toHaveLength(0);
    expect(await detectInReply('SUP-1', '2')).toHaveLength(0);
    await saveSettings({ detectPromises: false });
    expect(await detectInReply('SUP-1', '3')).toHaveLength(0);
  });
});

describe('customer portal', () => {
  it('shows only the safe stage to someone who can see the request', async () => {
    const v = await portalForRequest('SUP-1');
    expect(v).toEqual({ stageIndex: 2, stage: 'In development', message: 'A fix is being built.' });
    await saveSettings({ portalShowDate: true });
    expect((await portalForRequest('SUP-1'))?.plannedDate).toBe('2026-12-10');
  });

  it('shows nothing to someone who cannot see the request, or when turned off', async () => {
    jira.hiddenFromUser.add('SUP-1');
    expect(await portalForRequest('SUP-1')).toBeNull();
    jira.hiddenFromUser.clear();
    await saveSettings({ portalEnabled: false });
    expect(await portalForRequest('SUP-1')).toBeNull();
  });
});

describe('Rovo actions', () => {
  it('returns the fix chain for the open request', async () => {
    await trackPromise({ requestKey: 'SUP-1', promisedDate: '2026-12-12', source: 'manual' });
    const r = (await getPromiseContext({ context: { jira: { issueKey: 'SUP-1' } } })) as Record<string, unknown>;
    expect(r.request).toMatchObject({ key: 'SUP-1', customer: 'Acme Corp' });
    expect(r.developerWork).toEqual([
      { key: 'BUG-1', summary: 'Invoice export times out', status: 'In Progress', plan: 'Sprint 14 (ends Dec 9) · release v2.4 (Dec 10)', assignee: 'Dev Patel' },
    ]);
    expect((r.promises as { status: string }[])[0]?.status).toBe('On track');
  });

  it('describes customers waiting when asked about a dev item', async () => {
    await trackPromise({ requestKey: 'SUP-1', promisedDate: '2026-12-12', source: 'manual' });
    const r = (await getPromiseContext({ requestKey: 'bug-1' })) as Record<string, unknown>;
    expect(r).toMatchObject({ workItem: 'BUG-1', customersWaiting: 1 });
  });

  it('validates LLM inputs and returns friendly errors', async () => {
    expect(await getPromiseContext({})).toEqual({ error: expect.stringContaining('Which request?') });
    expect(await getPromiseContext({ requestKey: 'not a key' })).toEqual({ error: expect.stringContaining("doesn't look like") });
    expect(await trackPromiseAction({ requestKey: 'SUP-1', promisedDate: 'next friday' })).toEqual({ error: expect.stringContaining('YYYY-MM-DD') });
    expect(await trackPromiseAction({ requestKey: 'SUP-1', promisedDate: '2026-12-20' }, { principal: { accountId: 'agent-1' } })).toMatchObject({
      tracked: true,
      promisedDate: '2026-12-20',
    });
  });

  it('lists promises at risk', async () => {
    await trackPromise({ requestKey: 'SUP-1', promisedDate: '2026-12-05', source: 'manual' });
    const r = (await listPromisesAtRisk({ days: 7 })) as { promises: { status: string; request: string }[] };
    expect(r.promises[0]).toMatchObject({ request: 'SUP-1', status: 'At risk' });
  });
});
