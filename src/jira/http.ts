// One place for every Jira REST call: picks app or user identity, retries rate limits,
// and turns failures into a typed error with the status code.
import api, { type Route } from '@forge/api';

export type Actor = 'app' | 'user';

/** Pulls the human-readable part out of a Jira error body. */
export function jiraErrorText(body: string): string {
  try {
    const j = JSON.parse(body) as { errorMessage?: string; errorMessages?: string[]; errors?: Record<string, string>; message?: string };
    const parts = [j.errorMessage, j.message, ...(j.errorMessages ?? []), ...Object.values(j.errors ?? {})].filter(Boolean);
    if (parts.length > 0) return parts.join(' ');
  } catch {
    // not JSON
  }
  return body.slice(0, 300);
}

export class JiraError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string
  ) {
    super(`Jira ${status} on ${path}: ${jiraErrorText(body)}`);
    this.name = 'JiraError';
  }
}

const pathOf = (r: Route): string => (r as unknown as { value?: string }).value ?? String(r);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(actor: Actor, path: Route, init: RequestInit = {}): Promise<Response> {
  const client = actor === 'user' ? api.asUser() : api.asApp();
  const headers = { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) };
  for (let attempt = 0; ; attempt++) {
    const res = (await client.requestJira(path, { ...init, headers } as never)) as unknown as Response;
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 5) * 1000 : 500 * 2 ** attempt);
      continue;
    }
    return res;
  }
}

export async function jiraGet<T>(actor: Actor, path: Route): Promise<T> {
  const res = await call(actor, path);
  if (!res.ok) throw new JiraError(res.status, pathOf(path), await res.text());
  return (await res.json()) as T;
}

/** Like jiraGet but returns undefined on 404 (deleted or not visible). */
export async function jiraGetOptional<T>(actor: Actor, path: Route): Promise<T | undefined> {
  const res = await call(actor, path);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new JiraError(res.status, pathOf(path), await res.text());
  return (await res.json()) as T;
}

export async function jiraSend<T = unknown>(
  actor: Actor,
  method: 'POST' | 'PUT' | 'DELETE',
  path: Route,
  body?: unknown
): Promise<T | undefined> {
  const res = await call(actor, path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new JiraError(res.status, pathOf(path), await res.text());
  if (res.status === 204) return undefined;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : undefined;
}
