// The notes Kept posts when a promise gets worse: one internal note on the request (agents
// only), and one heads-up on the developer's work item naming the customer affected.
import { formatDate, formatDateWithDay } from '../domain/dates';
import { RISK_STYLE } from '../domain/labels';
import type { IsoDate, PromiseRecord } from '../domain/types';
import { adf, type Adf } from '../jira/comments';

function quote(text: string): string {
  const t = text.trim();
  return t.length > 140 ? `${t.slice(0, 139)}…` : t;
}

export function requestNote(promises: PromiseRecord[], today: IsoDate, links: { dev: Record<string, string> }): Adf {
  const blocks: unknown[] = [];
  for (const p of promises) {
    const style = RISK_STYLE[p.risk];
    const why = p.reasons.filter((r) => r.code !== 'recent-change');
    const changes = p.reasons.filter((r) => r.code === 'recent-change');
    const panelType = p.risk === 'tight' ? 'warning' : 'error';
    const heading = `${style.label}: promise to ${p.customer} (${formatDateWithDay(p.promisedDate, today)})`;
    const content: unknown[] = [adf.p(adf.strong(heading))];
    if (p.text) content.push(adf.p(adf.text('Promised: '), adf.em(`"${quote(p.text)}"`)));
    if (changes.length > 0) {
      content.push(adf.p(adf.strong('What changed')));
      content.push(adf.bullets(...changes.map((c) => [adf.text(c.message)])));
    }
    if (why.length > 0) {
      content.push(adf.p(adf.strong('Why it matters')));
      content.push(adf.bullets(...why.map((r) => [adf.text(r.message)])));
    }
    if (p.devIssueKey && links.dev[p.devIssueKey]) {
      content.push(adf.p(adf.text('Developer work item: '), adf.inlineCard(links.dev[p.devIssueKey] as string)));
    }
    blocks.push(adf.panel(panelType, ...content));
  }
  blocks.push(
    adf.p(
      adf.text('Next step: open '),
      adf.strong('Customer promises'),
      adf.text(' on this request and choose '),
      adf.strong('Draft update'),
      adf.text(', or ask the Kept agent in Rovo. Tell the customer before they find out.')
    )
  );
  blocks.push(adf.p(adf.em('Posted by Kept. Only agents can see internal notes.')));
  return adf.doc(...blocks);
}

export function devNote(promises: PromiseRecord[], today: IsoDate, links: { request: Record<string, string> }): Adf {
  const n = promises.length;
  const items = promises.map((p) => {
    const line: unknown[] = [
      adf.strong(p.customer),
      adf.text(` was promised a fix by ${formatDate(p.promisedDate, today)}. Now: ${RISK_STYLE[p.risk].label.toLowerCase()}`),
    ];
    if (p.expectedDate && p.risk !== 'broken') line.push(adf.text(` (the fix now lands ${formatDate(p.expectedDate, today)})`));
    line.push(adf.text('. Request: '));
    const url = links.request[p.requestKey];
    line.push(url ? adf.inlineCard(url) : adf.text(p.requestKey));
    return line;
  });
  return adf.doc(
    adf.panel(
      'note',
      adf.p(adf.strong(n === 1 ? 'Heads-up: a customer promise depends on this work item' : `Heads-up: ${n} customer promises depend on this work item`)),
      adf.bullets(...items),
      adf.p(adf.text('Support has been notified on the request. If the plan can change back, the promise recovers automatically.'))
    ),
    adf.p(adf.em('Posted by Kept.'))
  );
}
