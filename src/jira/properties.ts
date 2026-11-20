// The indexed "kept" work item property. jira:entityProperty in the manifest turns its fields
// into JQL: keptRisk, keptRank, keptPromiseDate, keptPromises, keptWaiting, keptEarliestPromise, keptAtRisk.
import { route } from '@forge/api';
import { jiraSend } from './http';

export const PROPERTY_KEY = 'kept';

export interface RequestProperty {
  risk: string;
  rank: number;
  promiseDate?: string;
  promises: number;
}

export interface DevProperty {
  waiting: number;
  earliestPromise?: string;
  atRisk: number;
}

export async function setKeptProperty(issueKey: string, value: Partial<RequestProperty & DevProperty>): Promise<void> {
  await jiraSend('app', 'PUT', route`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`, value);
}

export async function deleteKeptProperty(issueKey: string): Promise<void> {
  try {
    await jiraSend('app', 'DELETE', route`/rest/api/3/issue/${issueKey}/properties/${PROPERTY_KEY}`);
  } catch {
    // Already gone.
  }
}
