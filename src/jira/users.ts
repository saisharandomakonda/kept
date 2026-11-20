import { route } from '@forge/api';
import { jiraGetOptional } from './http';

const names = new Map<string, string>();

/** A person's display name from their account id (cached per invocation). */
export async function displayName(accountId: string | undefined): Promise<string | null> {
  if (!accountId) return null;
  if (names.has(accountId)) return names.get(accountId) as string;
  const u = await jiraGetOptional<{ displayName?: string }>('app', route`/rest/api/3/user?accountId=${accountId}`).catch(() => undefined);
  if (u?.displayName) names.set(accountId, u.displayName);
  return u?.displayName ?? null;
}
