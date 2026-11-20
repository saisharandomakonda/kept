// Spaces (projects), boards, sprints and releases.
import { route } from '@forge/api';
import { toIsoDate } from '../domain/dates';
import { jiraGet, jiraGetOptional, jiraSend, type Actor } from './http';

export interface SpaceInfo {
  id: string;
  key: string;
  name: string;
  type: string;
  avatarUrl?: string;
}

interface RawProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  avatarUrls?: Record<string, string>;
}

export async function listSpaces(actor: Actor = 'user'): Promise<SpaceInfo[]> {
  const out: SpaceInfo[] = [];
  for (let startAt = 0; startAt < 500; startAt += 50) {
    const res = await jiraGet<{ values: RawProject[]; isLast: boolean }>(
      actor,
      route`/rest/api/3/project/search?maxResults=50&startAt=${String(startAt)}&orderBy=name`
    );
    out.push(
      ...res.values.map((p) => ({ id: p.id, key: p.key, name: p.name, type: p.projectTypeKey, avatarUrl: p.avatarUrls?.['24x24'] }))
    );
    if (res.isLast) break;
  }
  return out;
}

const typeCache = new Map<string, string>();

export async function spaceType(projectKey: string): Promise<string | undefined> {
  if (typeCache.has(projectKey)) return typeCache.get(projectKey);
  const p = await jiraGetOptional<RawProject>('app', route`/rest/api/3/project/${projectKey}`);
  if (p) typeCache.set(projectKey, p.projectTypeKey);
  return p?.projectTypeKey;
}

export async function isServiceSpace(projectKey: string): Promise<boolean> {
  return (await spaceType(projectKey)) === 'service_desk';
}

export interface SprintRef {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  originBoardId?: number;
}

export async function getSprint(id: number): Promise<SprintRef | undefined> {
  return jiraGetOptional<SprintRef>('app', route`/rest/agile/1.0/sprint/${String(id)}`);
}

export async function sprintNames(ids: number[]): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const id of [...new Set(ids)].slice(0, 10)) {
    const s = await getSprint(id).catch(() => undefined);
    if (s) names[String(id)] = s.name;
  }
  return names;
}

export interface BoardRef {
  id: number;
  name: string;
  type: string;
}

export async function scrumBoards(projectKey: string, actor: Actor = 'user'): Promise<BoardRef[]> {
  const res = await jiraGet<{ values: BoardRef[] }>(actor, route`/rest/agile/1.0/board?projectKeyOrId=${projectKey}&type=scrum`);
  return res.values ?? [];
}

export async function createSprint(
  boardId: number,
  name: string,
  startDate: string,
  endDate: string,
  actor: Actor = 'user'
): Promise<SprintRef> {
  const s = await jiraSend<SprintRef>(actor, 'POST', route`/rest/agile/1.0/sprint`, {
    name,
    originBoardId: boardId,
    startDate: `${startDate}T09:00:00.000Z`,
    endDate: `${endDate}T17:00:00.000Z`,
  });
  return s as SprintRef;
}

export async function updateSprint(id: number, body: Record<string, unknown>, actor: Actor = 'user'): Promise<void> {
  await jiraSend(actor, 'POST', route`/rest/agile/1.0/sprint/${String(id)}`, body);
}

export async function moveToSprint(sprintId: number, issueKeys: string[], actor: Actor = 'user'): Promise<void> {
  await jiraSend(actor, 'POST', route`/rest/agile/1.0/sprint/${String(sprintId)}/issue`, { issues: issueKeys });
}

export interface ReleaseRef {
  id: string;
  name: string;
  released: boolean;
  releaseDate?: string;
  projectId?: number;
}

export async function createRelease(
  projectId: string,
  name: string,
  releaseDate: string,
  released = false,
  actor: Actor = 'user'
): Promise<ReleaseRef> {
  const v = await jiraSend<ReleaseRef>(actor, 'POST', route`/rest/api/3/version`, {
    projectId: Number(projectId),
    name,
    releaseDate,
    released,
    description: 'Created by Kept sample scenario',
  });
  return v as ReleaseRef;
}

export async function getRelease(id: string): Promise<ReleaseRef | undefined> {
  const v = await jiraGetOptional<ReleaseRef>('app', route`/rest/api/3/version/${id}`);
  return v ? { ...v, releaseDate: toIsoDate(v.releaseDate) } : undefined;
}
