// Internal notes, replies to customers, and reading replies.
import { route } from '@forge/api';
import { toIsoDate } from '../domain/dates';
import { adfToText } from '../domain/detect';
import { jiraGet, jiraGetOptional, jiraSend, type Actor } from './http';

export type Adf = { type: 'doc'; version: 1; content: unknown[] };

// ---- tiny ADF builders (Atlassian Document Format, Jira's rich text) ----
export const adf = {
  doc: (...content: unknown[]): Adf => ({ type: 'doc', version: 1, content }),
  p: (...content: unknown[]) => ({ type: 'paragraph', content }),
  text: (text: string) => ({ type: 'text', text }),
  strong: (text: string) => ({ type: 'text', text, marks: [{ type: 'strong' }] }),
  em: (text: string) => ({ type: 'text', text, marks: [{ type: 'em' }] }),
  link: (text: string, href: string) => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }),
  panel: (panelType: 'info' | 'note' | 'warning' | 'error' | 'success', ...content: unknown[]) => ({
    type: 'panel',
    attrs: { panelType },
    content,
  }),
  bullets: (...items: unknown[][]) => ({
    type: 'bulletList',
    content: items.map((inline) => ({ type: 'listItem', content: [{ type: 'paragraph', content: inline }] })),
  }),
  inlineCard: (url: string) => ({ type: 'inlineCard', attrs: { url } }),
};

/** Plain text → ADF paragraphs (blank lines split paragraphs, single newlines become line breaks). */
export function textToAdf(text: string): Adf {
  const paragraphs = text.replace(/\r/g, '').split(/\n{2,}/);
  return adf.doc(
    ...paragraphs.map((para) => {
      const lines = para.split('\n');
      const content: unknown[] = [];
      lines.forEach((line, i) => {
        if (i > 0) content.push({ type: 'hardBreak' });
        if (line) content.push(adf.text(line));
      });
      return { type: 'paragraph', content };
    })
  );
}

/** An internal note on a service request: visible to agents only. */
export async function addInternalNote(issueKey: string, body: Adf, actor: Actor = 'app'): Promise<string | undefined> {
  const res = await jiraSend<{ id: string }>(actor, 'POST', route`/rest/api/3/issue/${issueKey}/comment`, {
    body,
    properties: [{ key: 'sd.public.comment', value: { internal: true } }],
  });
  return res?.id;
}

/** A reply the customer sees (posted as the signed-in agent). */
export async function addCustomerReply(issueKey: string, text: string): Promise<string | undefined> {
  const res = await jiraSend<{ id: string }>('user', 'POST', route`/rest/api/3/issue/${issueKey}/comment`, {
    body: textToAdf(text),
    properties: [{ key: 'sd.public.comment', value: { internal: false } }],
  });
  return res?.id;
}

/** A normal comment (used on developer work items). */
export async function addComment(issueKey: string, body: Adf, actor: Actor = 'app'): Promise<string | undefined> {
  const res = await jiraSend<{ id: string }>(actor, 'POST', route`/rest/api/3/issue/${issueKey}/comment`, { body });
  return res?.id;
}

interface RawComment {
  id: string;
  author?: { accountId: string; displayName: string };
  body?: unknown;
  created: string;
  jsdPublic?: boolean;
}

export interface Reply {
  id: string;
  authorId?: string;
  authorName?: string;
  created: string;
  date: string;
  text: string;
  isPublic: boolean;
}

function toReply(c: RawComment): Reply {
  return {
    id: c.id,
    authorId: c.author?.accountId,
    authorName: c.author?.displayName,
    created: c.created,
    date: toIsoDate(c.created) ?? c.created.slice(0, 10),
    text: adfToText(c.body).trim(),
    isPublic: c.jsdPublic !== false,
  };
}

export async function getComment(issueKey: string, commentId: string): Promise<Reply | undefined> {
  const c = await jiraGetOptional<RawComment>('app', route`/rest/api/3/issue/${issueKey}/comment/${commentId}`);
  return c ? toReply(c) : undefined;
}

export async function listComments(issueKey: string, actor: Actor = 'app', max = 100): Promise<Reply[]> {
  const res = await jiraGet<{ comments: RawComment[] }>(
    actor,
    route`/rest/api/3/issue/${issueKey}/comment?maxResults=${String(max)}&orderBy=-created`
  );
  return (res.comments ?? []).map(toReply);
}
