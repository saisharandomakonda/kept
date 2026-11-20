// Site-specific custom field ids (the Sprint and Organizations fields differ per site).
import { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { jiraGet } from './http';

interface FieldMeta {
  id: string;
  name: string;
  schema?: { custom?: string };
}

export interface FieldIds {
  sprint?: string;
  organizations?: string;
}

const KEY = 'meta:fieldIds:v1';
let memo: FieldIds | undefined;

export async function discoverFieldIds(): Promise<FieldIds> {
  const fields = await jiraGet<FieldMeta[]>('app', route`/rest/api/3/field`);
  const ids: FieldIds = {
    sprint: fields.find((f) => f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint')?.id,
    organizations: fields.find((f) => f.schema?.custom === 'com.atlassian.servicedesk:sd-customer-organizations')?.id,
  };
  await kvs.set(KEY, ids);
  memo = ids;
  return ids;
}

export async function fieldIds(): Promise<FieldIds> {
  if (memo) return memo;
  const stored = await kvs.get<FieldIds>(KEY);
  if (stored?.sprint) {
    memo = stored;
    return stored;
  }
  return discoverFieldIds();
}
