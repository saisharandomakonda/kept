import { route } from '@forge/api';
import { jiraGetOptional } from './http';

interface UserInfo {
  displayName?: string;
  /** 'atlassian' (licensed user), 'customer' (portal-only customer) or 'app'. */
  accountType?: string;
}

const cache = new Map<string, UserInfo>();

async function user(accountId: string): Promise<UserInfo | undefined> {
  if (cache.has(accountId)) return cache.get(accountId);
  const u = await jiraGetOptional<UserInfo>('app', route`/rest/api/3/user?accountId=${accountId}`).catch(() => undefined);
  if (u) cache.set(accountId, u);
  return u;
}

/** A person's display name from their account id (cached per invocation). */
export async function displayName(accountId: string | undefined): Promise<string | null> {
  if (!accountId) return null;
  return (await user(accountId))?.displayName ?? null;
}

/** True for portal-only customer accounts (people who raise requests, not agents). */
export async function isCustomerAccount(accountId: string | undefined): Promise<boolean> {
  if (!accountId) return false;
  return (await user(accountId))?.accountType === 'customer';
}
