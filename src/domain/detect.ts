// Finds commitments in a support agent's public reply ("we expect the fix by Dec 10").
// Rules + a date parser, no AI: it runs on every reply for free and is easy to explain.
// Rovo handles the wording these rules miss (see the find-promises-in-request action).
import * as chrono from 'chrono-node';
import { addDays, daysBetween, isIsoDate } from './dates';
import type { IsoDate } from './types';

export interface Detected {
  /** The promised date, or undefined when the promise refers to "the next release". */
  date?: IsoDate;
  kind: 'date' | 'release';
  /** The sentence that contains the promise, trimmed for display. */
  sentence: string;
  /** The words that gave the date ("by Friday", "next release"). */
  matched: string;
  confidence: 'high' | 'medium';
}

// Words that turn a date into a commitment about the fix.
const COMMITMENT =
  /\b(fix(ed|es)?|ship(ped|s)?|release[ds]?|deploy(ed|s)?|resolv(e|ed)|patch(ed)?|roll(ed)? out|live|available|ready|done|land(s|ed)?|deliver(ed)?|we'?ll|we will|we expect|expect(ed)?|plan(ned)? to|planning to|target(ing|ed)?|aim(ing)? to|scheduled|should be|eta)\b/i;
const STRONG =
  /\b(we'?ll|we will|we expect|expect(ed)? (to|the|it|a)|will be (fixed|released|resolved|live|available|deployed)|scheduled|planned for|target(ing|ed)?|eta|commit(ted)?)\b/i;
// Phrases that mean "this is NOT a promise".
const NEGATION =
  /\b(can'?t|cannot|can not|unable to|won'?t be able|not able to|no eta|don'?t have (a|an) (date|eta|timeline)|no (date|timeline) yet|not sure when|can'?t (promise|commit)|unable to (promise|commit)|no guarantee)\b/i;
const NEXT_RELEASE = /\b(next|upcoming|coming) (release|update|version|deploy(ment)?)\b|\brelease (\d+(\.\d+)+)\b/i;
const NTH_DAY = /\b(?:on|by|before) the (\d{1,2})(?:st|nd|rd|th)\b/i;

function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function trimSentence(s: string, max = 160): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function isoFromParts(year: number, month: number, day: number): IsoDate {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function weekday(date: IsoDate): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Friday on or before a weekend date; business promises don't land on Saturdays. */
function backToFriday(date: IsoDate): IsoDate {
  const d = weekday(date);
  if (d === 6) return addDays(date, -1);
  if (d === 0) return addDays(date, -2);
  return date;
}

function fridayOfWeekContaining(date: IsoDate): IsoDate {
  const d = weekday(date); // 0 Sun .. 6 Sat
  const offset = d === 0 ? -2 : 5 - d;
  return addDays(date, offset);
}

function parseDate(sentence: string, ref: IsoDate): { date: IsoDate; matched: string; certain: boolean } | undefined {
  const refDate = new Date(`${ref}T12:00:00Z`);
  const normalised = sentence.replace(/\bEOD\b/gi, 'end of day').replace(/\bEOW\b/gi, 'end of the week');

  const results = chrono.parse(normalised, refDate, { forwardDate: true });
  for (const r of results) {
    let date = isoFromParts(r.start.get('year') ?? 0, r.start.get('month') ?? 0, r.start.get('day') ?? 0);
    if (!isIsoDate(date)) continue;
    const text = r.text.toLowerCase();
    if (/^next week$/.test(text)) date = fridayOfWeekContaining(date);
    else if (/end of (the |this |next )?week/.test(text)) date = backToFriday(date);
    const ahead = daysBetween(ref, date);
    if (ahead < 0) continue;
    // "on Nov 20" written in December means last November, not next year's.
    if (ahead > 180 && !r.start.isCertain('year')) continue;
    return { date, matched: r.text, certain: r.start.isCertain('day') || /week|month/.test(text) };
  }

  const nth = NTH_DAY.exec(sentence);
  if (nth) {
    const day = Number(nth[1]);
    const [y, m] = [Number(ref.slice(0, 4)), Number(ref.slice(5, 7))];
    let candidate = isoFromParts(y, m, day);
    if (isIsoDate(candidate) && daysBetween(ref, candidate) < 0) {
      candidate = m === 12 ? isoFromParts(y + 1, 1, day) : isoFromParts(y, m + 1, day);
    }
    if (isIsoDate(candidate)) return { date: candidate, matched: nth[0], certain: true };
  }
  return undefined;
}

/**
 * Finds promises in a reply.
 * @param text plain text of the reply
 * @param replyDate the day the reply was posted (dates like "Friday" are relative to it)
 */
export function detectCommitments(text: string, replyDate: IsoDate): Detected[] {
  const found: Detected[] = [];
  for (const raw of splitSentences(text)) {
    if (raw.endsWith('?')) continue; // a question, not a commitment
    if (NEGATION.test(raw)) continue;
    if (!COMMITMENT.test(raw)) continue;

    const parsed = parseDate(raw, replyDate);
    if (parsed) {
      found.push({
        date: parsed.date,
        kind: 'date',
        sentence: trimSentence(raw),
        matched: parsed.matched,
        confidence: STRONG.test(raw) && parsed.certain ? 'high' : 'medium',
      });
      continue;
    }

    const release = NEXT_RELEASE.exec(raw);
    if (release) {
      found.push({
        kind: 'release',
        sentence: trimSentence(raw),
        matched: release[0],
        confidence: STRONG.test(raw) ? 'high' : 'medium',
      });
    }
  }
  // One promise per date is enough.
  const seen = new Set<string>();
  return found.filter((d) => {
    const k = `${d.kind}:${d.date ?? d.matched.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Turns Atlassian Document Format (comment bodies) into plain text. */
export function adfToText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: { text?: string } };
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return '\n';
  if (n.type === 'mention') return n.attrs?.text ?? '';
  const inner = (n.content ?? []).map(adfToText).join('');
  if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'listItem') return `${inner}\n`;
  return inner;
}
