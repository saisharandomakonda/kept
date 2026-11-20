import { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { jiraGet } from './http';

let memo: string | undefined;

/** The site's base URL, e.g. https://acme.atlassian.net (used for links in notes). */
export async function siteUrl(): Promise<string> {
  if (memo) return memo;
  const stored = await kvs.get<string>('meta:siteUrl');
  if (stored) return (memo = stored);
  const info = await jiraGet<{ baseUrl: string }>('app', route`/rest/api/3/serverInfo`);
  memo = info.baseUrl.replace(/\/$/, '');
  await kvs.set('meta:siteUrl', memo);
  return memo;
}

export async function browseUrl(key: string): Promise<string> {
  return `${await siteUrl()}/browse/${key}`;
}

/** Sets a short-lived marker. Returns false if it already existed (someone else did the work). */
export async function claimOnce(key: string, minutes = 10): Promise<boolean> {
  try {
    await kvs.set(key, Date.now(), { ttl: { value: minutes, unit: 'MINUTES' }, keyPolicy: 'FAIL_IF_EXISTS' });
    return true;
  } catch {
    return false;
  }
}
