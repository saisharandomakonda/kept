// In-memory fakes for @forge/kvs and @forge/api, so services can be tested end to end without a site.
// The fake Jira implements only the endpoints Kept calls.

type Json = Record<string, unknown>;

// ---------------- KVS ----------------
const INDEXES: Record<string, { partition: string[]; range?: string }> = {
  'by-request': { partition: ['requestKey'], range: 'promisedDate' },
  'by-dev': { partition: ['devIssueKey'], range: 'promisedDate' },
  'by-state': { partition: ['state'], range: 'promisedDate' },
  'by-project-state': { partition: ['projectKey', 'state'], range: 'promisedDate' },
};

export const store = {
  kv: new Map<string, unknown>(),
  entities: new Map<string, Map<string, Json>>(),
  reset() {
    this.kv.clear();
    this.entities.clear();
  },
};

function table(name: string) {
  if (!store.entities.has(name)) store.entities.set(name, new Map());
  return store.entities.get(name) as Map<string, Json>;
}

class Query {
  private idx?: string;
  private partition: unknown[] = [];
  private range?: [string, string];
  private order: 'ASC' | 'DESC' = 'ASC';
  private max = 10;
  private offset = 0;
  constructor(private readonly name: string) {}
  index(name: string, opts?: { partition?: unknown[] }) {
    this.idx = name;
    this.partition = opts?.partition ?? [];
    return this;
  }
  where(c: { between: [string, string] }) {
    this.range = c.between;
    return this;
  }
  sort(s: 'ASC' | 'DESC') {
    this.order = s;
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  cursor(c: string) {
    this.offset = Number(c);
    return this;
  }
  async getMany() {
    const def = INDEXES[this.idx ?? ''];
    if (!def) throw new Error(`Unknown index ${this.idx}`);
    let rows = [...table(this.name).entries()].filter(([, v]) => def.partition.every((attr, i) => v[attr] === this.partition[i]));
    if (this.range && def.range) {
      const [a, b] = this.range;
      rows = rows.filter(([, v]) => String(v[def.range as string]) >= a && String(v[def.range as string]) <= b);
    }
    rows.sort(([, x], [, y]) => String(x[def.range ?? ''] ?? '').localeCompare(String(y[def.range ?? ''] ?? '')));
    if (this.order === 'DESC') rows.reverse();
    const page = rows.slice(this.offset, this.offset + this.max);
    const next = this.offset + this.max < rows.length ? String(this.offset + this.max) : undefined;
    return { results: page.map(([key, value]) => ({ key, value: structuredClone(value) })), nextCursor: next };
  }
}

export const kvsFake = {
  async get(key: string) {
    return structuredClone(store.kv.get(key));
  },
  async set(key: string, value: unknown, opts?: { keyPolicy?: string }) {
    if (opts?.keyPolicy === 'FAIL_IF_EXISTS' && store.kv.has(key)) throw new Error('KEY_ALREADY_EXISTS');
    store.kv.set(key, structuredClone(value));
  },
  async delete(key: string) {
    store.kv.delete(key);
  },
  entity(name: string) {
    return {
      get: async (id: string) => structuredClone(table(name).get(id)),
      set: async (id: string, v: Json) => void table(name).set(id, structuredClone(v)),
      delete: async (id: string) => void table(name).delete(id),
      query: () => new Query(name),
    };
  },
};

export const kvsModule = {
  kvs: kvsFake,
  default: kvsFake,
  Sort: { ASC: 'ASC', DESC: 'DESC' },
  WhereConditions: { between: (a: string, b: string) => ({ between: [a, b] }) },
};

// ---------------- Jira ----------------
export interface FakeIssue {
  id: string;
  key: string;
  fields: Json;
  comments: { id: string; author?: { accountId: string; displayName: string }; body: unknown; created: string; jsdPublic?: boolean }[];
  properties: Record<string, unknown>;
}

export const jira = {
  issues: new Map<string, FakeIssue>(),
  projects: new Map<string, { id: string; key: string; name: string; projectTypeKey: string }>(),
  sprints: new Map<number, { id: number; name: string; state: string }>(),
  calls: [] as { actor: string; method: string; path: string; body?: unknown }[],
  /** Requests the "user" is NOT allowed to see. */
  hiddenFromUser: new Set<string>(),
  reset() {
    this.issues.clear();
    this.projects.clear();
    this.sprints.clear();
    this.calls = [];
    this.hiddenFromUser.clear();
  },
  posted(kind: 'comment' | 'property', key?: string) {
    return this.calls.filter(
      (c) =>
        (kind === 'comment' ? c.method === 'POST' && /\/comment$/.test(c.path) : c.method === 'PUT' && /\/properties\//.test(c.path)) &&
        (!key || c.path.includes(`/issue/${key}/`))
    );
  },
};

function res(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

function pickFields(issue: FakeIssue, fields: string | null): FakeIssue {
  if (!fields) return issue;
  const keep = fields.split(',');
  const f: Json = {};
  for (const k of keep) if (k in issue.fields) f[k] = issue.fields[k];
  return { ...issue, fields: f };
}

function handle(actor: string, method: string, url: string, body?: Json) {
  const [path, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  let m: RegExpMatchArray | null;
  const p = path as string;

  if (p === '/rest/api/3/field') {
    return res(200, [
      { id: 'customfield_10020', name: 'Sprint', schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' } },
      { id: 'customfield_10002', name: 'Organizations', schema: { custom: 'com.atlassian.servicedesk:sd-customer-organizations' } },
    ]);
  }
  if (p === '/rest/api/3/serverInfo') return res(200, { baseUrl: 'https://test.atlassian.net' });
  if (p === '/rest/api/3/search/jql' && method === 'POST') {
    const keys = [...String(body?.jql ?? '').matchAll(/"([A-Z]+-\d+)"/g)].map((x) => x[1] as string);
    const issues = keys
      .map((k) => jira.issues.get(k))
      .filter((i): i is FakeIssue => !!i && !(actor === 'user' && jira.hiddenFromUser.has(i.key)));
    return res(200, { issues: issues.map((i) => pickFields(i, (body?.fields as string[]).join(','))) });
  }
  if ((m = p.match(/^\/rest\/api\/3\/project\/([A-Z0-9]+)$/))) {
    const proj = jira.projects.get(m[1] as string);
    return proj ? res(200, proj) : res(404, { errorMessages: ['No project'] });
  }
  if ((m = p.match(/^\/rest\/agile\/1\.0\/sprint\/(\d+)$/))) {
    const s = jira.sprints.get(Number(m[1]));
    return s ? res(200, s) : res(404);
  }
  if ((m = p.match(/^\/rest\/servicedeskapi\/request\/([A-Z]+-\d+)$/))) {
    const i = jira.issues.get(m[1] as string);
    return i && !(actor === 'user' && jira.hiddenFromUser.has(i.key)) ? res(200, { issueKey: i.key }) : res(404);
  }
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment\/(\d+)$/))) {
    const i = jira.issues.get(m[1] as string);
    const c = i?.comments.find((x) => x.id === m?.[2]);
    return c ? res(200, c) : res(404);
  }
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/))) {
    const i = jira.issues.get(m[1] as string);
    if (!i) return res(404);
    if (method === 'POST') {
      const id = String(1000 + i.comments.length);
      const internal = (body?.properties as { value: { internal: boolean } }[] | undefined)?.[0]?.value.internal;
      i.comments.push({ id, body: body?.body, created: '2026-12-01T10:00:00.000+0000', jsdPublic: internal === undefined ? true : !internal, author: { accountId: actor === 'app' ? 'app' : 'agent-1', displayName: actor === 'app' ? 'Kept' : 'Maya Chen' } });
      return res(201, { id });
    }
    return res(200, { comments: [...i.comments].reverse() });
  }
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/properties\/(\w+)$/))) {
    const i = jira.issues.get(m[1] as string);
    if (!i) return res(404);
    if (method === 'PUT') i.properties[m[2] as string] = body;
    if (method === 'DELETE') delete i.properties[m[2] as string];
    return res(method === 'PUT' ? 200 : 204, method === 'PUT' ? {} : undefined);
  }
  if ((m = p.match(/^\/rest\/api\/3\/issue\/([A-Z0-9-]+)$/)) && method === 'GET') {
    const i = jira.issues.get(m[1] as string) ?? [...jira.issues.values()].find((x) => x.id === m?.[1]);
    if (!i || (actor === 'user' && jira.hiddenFromUser.has(i.key))) return res(404);
    return res(200, pickFields(i, params.get('fields')));
  }
  return res(404, { error: `fake jira: no route for ${method} ${url}` });
}

function makeClient(actor: string) {
  return {
    requestJira: async (path: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(init.body) as Json) : undefined;
      jira.calls.push({ actor, method, path, body });
      return handle(actor, method, path, body);
    },
  };
}

export const apiModule = {
  default: { asApp: () => makeClient('app'), asUser: () => makeClient('user') },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (i < values.length ? encodeURIComponent(String(values[i])).replace(/%2C/g, ',') : ''), ''),
};

// ---------------- builders ----------------
export function addProject(key: string, type: 'service_desk' | 'software', id = String(10000 + jira.projects.size)) {
  jira.projects.set(key, { id, key, name: key, projectTypeKey: type });
}

export function addIssue(key: string, fields: Json, comments: FakeIssue['comments'] = []) {
  const projectKey = key.split('-')[0] as string;
  const proj = jira.projects.get(projectKey);
  jira.issues.set(key, {
    id: String(20000 + jira.issues.size),
    key,
    fields: { summary: key, project: { key: projectKey, name: projectKey, projectTypeKey: proj?.projectTypeKey }, ...fields },
    comments,
    properties: {},
  });
}

export function link(requestKey: string, devKey: string) {
  const r = jira.issues.get(requestKey) as FakeIssue;
  const links = (r.fields.issuelinks as unknown[] | undefined) ?? [];
  links.push({ id: String(links.length + 1), type: { name: 'Relates', inward: 'relates to', outward: 'relates to' }, outwardIssue: { key: devKey } });
  r.fields.issuelinks = links;
}
