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

/** Forge storage keys allow only letters, digits, spaces and : . _ - # */
export function safeKey(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9:._#-]/g, '_').slice(0, 450);
}

/** Sets a short-lived marker. Returns false if it already existed (someone else did the work). */
export async function claimOnce(key: string, minutes = 10): Promise<boolean> {
  try {
    await kvs.set(safeKey(key), Date.now(), { ttl: { value: minutes, unit: 'MINUTES' }, keyPolicy: 'FAIL_IF_EXISTS' });
    return true;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (/exist/i.test(msg) || (e as { code?: string }).code === 'KEY_ALREADY_EXISTS') return false;
    // Any other storage problem: don't lose the alert because of the guard.
    console.warn(`Kept: alert guard failed (${msg.slice(0, 120)}); alerting anyway`);
    return true;
  }
}
