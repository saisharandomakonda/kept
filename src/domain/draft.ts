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

  if (risk === 'on-track') {
    lines.push(
      `A quick update on ${topic}: the fix is still on track for ${promised}.`,
      '',
      "I'll let you know as soon as it's released."
    );
    lines.push('', signOff(input.agentName).replace('Thanks for your patience', 'Best regards'));
    return lines.join('\n');
  }

  if (risk === 'tight') {
    // Honest about the small margin, without alarming the customer.
    lines.push(
      `A quick update on ${topic}: the fix is still planned to reach you by ${promised}, but there's little room to spare.`,
      '',
      "I'm watching it closely and will tell you straight away if anything changes."
    );
    lines.push('', signOff(input.agentName).replace('Thanks for your patience', 'Best regards'));
    return lines.join('\n');
  }

  // at-risk, broken, unplanned, unknown: be honest before the customer finds out.
  const passed = risk === 'broken';
  lines.push(
    passed
      ? `I owe you an update on ${topic}. I told you we expected the fix by ${promised}, and we've missed that date. I'm sorry.`
      : `I want to give you an honest update on ${topic}. I told you we expected the fix by ${promised}, and I'm no longer confident we'll make that date.`
  );
  lines.push('');
  if (input.newDate) {
    lines.push(
      `Our engineering team has re-planned this work. The fix is now expected by ${formatDateWithDay(input.newDate, today)}.`,
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

/**
 * The new date to offer when the plan now lands after the promise: the expected date plus the
 * safety margin (at least a day). Used by the panel's Draft update and by the Rovo actions.
 */
export function suggestDate(p: { expectedDate?: IsoDate; promisedDate: IsoDate }, marginDays: number): IsoDate | undefined {
  return p.expectedDate && p.expectedDate > p.promisedDate ? addDays(p.expectedDate, Math.max(marginDays, 1)) : undefined;
}

const INTERNAL_WORDS =[/\bsprint\b/i, /\bjira\b/i, /\bbacklog\b/i, /\bstory points?\b/i];
const KEY_LIKE = /\b([A-Z][A-Z0-9]{1,9})-\d+\b/g;

/** Space keys of the work item keys a text mentions, e.g. "BUG-12" → "BUG" (also catches "UTF-8"). */
export function keyPrefixes(text: string): string[] {
  return [...new Set([...text.matchAll(KEY_LIKE)].map((m) => m[1] as string))];
}

/**
 * True when text seems to contain internal details (a work item key, sprint, backlog, ...).
 * Pass the space keys you know about to avoid false alarms on words like "UTF-8" or "ISO-8601":
 * then only keys from those spaces count. Without them, anything shaped like a key counts.
 */
export function looksInternal(text: string, spaceKeys?: readonly string[]): boolean {
  if (INTERNAL_WORDS.some((p) => p.test(text))) return true;
  const prefixes = keyPrefixes(text);
  return spaceKeys ? prefixes.some((p) => spaceKeys.includes(p)) : prefixes.length > 0;
}
