// Customer update drafts. Honest, specific, blame-free, and safe to send: no internal names,
// work item keys, sprint names or team jargon ever appear in customer-facing text.
import { addDays, formatDateWithDay } from './dates';
import type { IsoDate, RiskLevel } from './types';

export interface DraftInput {
  customerName?: string;
  /** Request summary, as the customer wrote it. */
  topic: string;
  risk: RiskLevel;
  promisedDate: IsoDate;
  /** The new date the agent is willing to commit to (if re-promising). */
  newDate?: IsoDate;
  deliveredAt?: IsoDate;
  agentName?: string;
  today: IsoDate;
}

function greeting(name?: string): string {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Hi ${first},` : 'Hi there,';
}

function signOff(agent?: string): string {
  const first = agent?.trim().split(/\s+/)[0];
  return first ? `Thanks for your patience,\n${first}` : 'Thanks for your patience.';
}

function topicPhrase(topic: string): string {
  const t = topic.trim().replace(/[.!?]+$/, '');
  return t ? `"${t}"` : 'your request';
}

export function draftCustomerUpdate(input: DraftInput): string {
  const { risk, today } = input;
  const promised = formatDateWithDay(input.promisedDate, today);
  const topic = topicPhrase(input.topic);
  const lines: string[] = [greeting(input.customerName), ''];

  if (risk === 'delivered') {
    const when = input.deliveredAt ? ` on ${formatDateWithDay(input.deliveredAt, today)}` : '';
    lines.push(
      `Good news: the fix for ${topic} was released${when}.`,
      '',
      "Could you check that everything works as expected on your side? If anything still looks wrong, reply here and I'll pick it up straight away."
    );
    lines.push('', signOff(input.agentName).replace('Thanks for your patience', 'Thanks again for reporting this'));
    return lines.join('\n');
  }

  if (risk === 'on-track' || risk === 'tight') {
    lines.push(
      `A quick update on ${topic}: the fix is still on track for ${promised}.`,
      '',
      "I'll let you know as soon as it's released."
    );
    lines.push('', signOff(input.agentName).replace('Thanks for your patience', 'Best regards'));
    return lines.join('\n');
  }

  // at-risk, broken, unplanned, unknown: be honest before the customer finds out.
  const passed = risk === 'broken';
  lines.push(
    passed
      ? `I owe you an update on ${topic}. I told you we expected the fix by ${promised}, and we've missed that date. I'm sorry.`
      : `I want to give you an honest update on ${topic}. I told you we expected the fix by ${promised}, and that date has moved.`
  );
  lines.push('');
  if (input.newDate) {
    lines.push(
      `Our engineering team had to re-plan this work. The fix is now expected by ${formatDateWithDay(input.newDate, today)}.`,
      "I know you may have been planning around the original date, and I'm sorry for the change."
    );
  } else {
    const checkIn = formatDateWithDay(addDays(today, 3), today);
    lines.push(
      "The fix is taking longer than we expected, and I don't have a confirmed new date yet.",
      `I'll come back to you with a firm date by ${checkIn} at the latest.`
    );
  }
  lines.push(
    '',
    "I'm keeping a close eye on it and will tell you the moment it's released. If the new timing causes problems for you, reply here and I'll see what we can do."
  );
  lines.push('', signOff(input.agentName));
  return lines.join('\n');
}

const INTERNAL_PATTERNS = [/\b[A-Z][A-Z0-9]{1,9}-\d+\b/, /\bsprint\b/i, /\bjira\b/i, /\bbacklog\b/i, /\bstory points?\b/i];

/** True when text seems to contain internal details (a work item key, sprint, backlog, ...). */
export function looksInternal(text: string): boolean {
  return INTERNAL_PATTERNS.some((p) => p.test(text));
}
