// Reads work items and maps them to Kept's domain types.
import { route } from '@forge/api';
import { toIsoDate } from '../domain/dates';
import type { DevSnapshot, SprintInfo, StatusCategory, VersionInfo } from '../domain/types';
import { fieldIds } from './fields';
import { jiraGetOptional, jiraSend, type Actor } from './http';

interface RawSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
}

interface RawLink {
  id: string;
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { key: string };
  outwardIssue?: { key: string };
}

export interface RawIssue {
  id: string;
  key: string;
  fields: Record<string, unknown> & {
    summary?: string;
    status?: { name: string; statusCategory?: { key: string } };
    resolutiondate?: string | null;
    fixVersions?: { id: string; name: string; released?: boolean; releaseDate?: string }[];
    duedate?: string | null;
    priority?: { name: string } | null;
    assignee?: { displayName: string; accountId: string } | null;
    reporter?: { displayName: string; accountId: string } | null;
    project?: { key: string; name: string; projectTypeKey?: string };
    issuelinks?: RawLink[];
    issuetype?: { name: string };
    labels?: string[];
  };
}

const DEV_FIELDS = ['summary', 'status', 'resolutiondate', 'fixVersions', 'duedate', 'priority', 'assignee', 'project', 'issuetype'];

function sprintsOf(value: unknown): SprintInfo[] {
  if (!Array.isArray(value)) return [];
  return (value as RawSprint[]).map((s) => ({
    id: s.id,
    name: s.name,
    state: (['active', 'future', 'closed'].includes(String(s.state).toLowerCase()) ? String(s.state).toLowerCase() : 'future') as SprintInfo['state'],
    startDate: toIsoDate(s.startDate),
    endDate: toIsoDate(s.endDate),
  }));
}

export function toDevSnapshot(issue: RawIssue, sprintField?: string): DevSnapshot {
  const f = issue.fields;
  const cat = (f.status?.statusCategory?.key ?? 'new') as StatusCategory;
  const versions: VersionInfo[] = (f.fixVersions ?? []).map((v) => ({
    id: String(v.id),
    name: v.name,
    released: !!v.released,
    releaseDate: toIsoDate(v.releaseDate),
  }));
  return {
    key: issue.key,
    summary: f.summary ?? '',
    status: f.status?.name ?? 'Unknown',
    statusCategory: ['new', 'indeterminate', 'done'].includes(cat) ? cat : 'new',
    resolutionDate: toIsoDate(f.resolutiondate ?? undefined),
    fixVersions: versions,
    sprints: sprintField ? sprintsOf(f[sprintField]) : [],
    dueDate: toIsoDate(f.duedate ?? undefined),
    priority: f.priority?.name,
    assigneeName: f.assignee?.displayName,
    projectKey: f.project?.key ?? issue.key.split('-')[0] ?? '',
    projectName: f.project?.name,
  };
}

export async function getIssue(key: string, fields: string[], actor: Actor = 'app'): Promise<RawIssue | undefined> {
  return jiraGetOptional<RawIssue>(actor, route`/rest/api/3/issue/${key}?fields=${fields.join(',')}`);
}

/** Fetches several work items in one search. Missing or invisible keys are simply absent. */
export async function searchIssues(jql: string, fields: string[], max = 100, actor: Actor = 'app'): Promise<RawIssue[]> {
  const out: RawIssue[] = [];
  let nextPageToken: string | undefined;
  do {
    const res = await jiraSend<{ issues: RawIssue[]; nextPageToken?: string }>(actor, 'POST', route`/rest/api/3/search/jql`, {
      jql,
      fields,
      maxResults: Math.min(100, max - out.length),
      ...(nextPageToken ? { nextPageToken } : {}),
    });
    out.push(...(res?.issues ?? []));
    nextPageToken = res?.nextPageToken;
  } while (nextPageToken && out.length < max);
  return out;
}

export async function getDevSnapshots(keys: string[]): Promise<Map<string, DevSnapshot>> {
  const map = new Map<string, DevSnapshot>();
  const unique = [...new Set(keys)].filter(Boolean);
  if (unique.length === 0) return map;
  const { sprint } = await fieldIds();
  const fields = sprint ? [...DEV_FIELDS, sprint] : DEV_FIELDS;
  const issues = await searchIssues(`key in (${unique.map((k) => `"${k}"`).join(',')})`, fields, unique.length);
  for (const i of issues) map.set(i.key, toDevSnapshot(i, sprint));
  return map;
}

export async function getDevSnapshot(key: string): Promise<DevSnapshot | undefined> {
  return (await getDevSnapshots([key])).get(key);
}

export interface LinkedItem {
  key: string;
  linkId: string;
  /** How the request relates to it, e.g. "is escalated to", "relates to". */
  relation: string;
}

export function linkedItems(issue: RawIssue): LinkedItem[] {
  return (issue.fields.issuelinks ?? []).map((l) =>
    l.outwardIssue
      ? { key: l.outwardIssue.key, linkId: l.id, relation: l.type.outward }
      : { key: l.inwardIssue?.key ?? '', linkId: l.id, relation: l.type.inward }
  ).filter((l) => l.key);
}

export const REQUEST_FIELDS = ['summary', 'status', 'issuelinks', 'reporter', 'assignee', 'project', 'created'];

export interface RequestInfo {
  key: string;
  id: string;
  summary: string;
  status: string;
  projectKey: string;
  projectType?: string;
  reporterName?: string;
  reporterId?: string;
  customer: string;
  links: LinkedItem[];
}

export async function getRequest(key: string, actor: Actor = 'app'): Promise<RequestInfo | undefined> {
  const { organizations } = await fieldIds();
  const issue = await getIssue(key, organizations ? [...REQUEST_FIELDS, organizations] : REQUEST_FIELDS, actor);
  if (!issue) return undefined;
  const orgs = organizations ? (issue.fields[organizations] as { name: string }[] | undefined) : undefined;
  const f = issue.fields;
  return {
    key: issue.key,
    id: issue.id,
    summary: f.summary ?? '',
    status: f.status?.name ?? '',
    projectKey: f.project?.key ?? '',
    projectType: f.project?.projectTypeKey,
    reporterName: f.reporter?.displayName,
    reporterId: f.reporter?.accountId,
    customer: orgs?.[0]?.name ?? f.reporter?.displayName ?? 'Customer',
    links: linkedItems(issue),
  };
}
