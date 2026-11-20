import { describe, expect, it } from 'vitest';
import { adfToText, detectCommitments } from '../../src/domain/detect';

const REF = '2026-12-01'; // a Tuesday

const one = (text: string) => {
  const r = detectCommitments(text, REF);
  expect(r).toHaveLength(1);
  return r[0]!;
};

describe('detectCommitments: finds promises', () => {
  it.each([
    ['We expect the fix by Dec 10.', '2026-12-10', 'high'],
    ['Our team will have this fixed by December 18th.', '2026-12-18', 'medium'],
    ["We'll ship the fix by Friday.", '2026-12-04', 'medium'],
    ['The fix should be live within 2 weeks.', '2026-12-15', 'medium'],
    ['This is scheduled to be released next week.', '2026-12-11', 'high'],
    ['We are aiming to ship this by the end of next week.', '2026-12-11', 'medium'],
    ['It should be fixed by the end of the month', '2026-12-31', 'medium'],
    ['ETA for the patch is 12/18.', '2026-12-18', 'high'],
    ['We will have it resolved on the 15th.', '2026-12-15', 'high'],
    ['The fix will be released tomorrow.', '2026-12-02', 'high'],
    ['Engineering expects to deploy the fix EOD Monday.', '2026-12-07', 'medium'],
  ])('%s', (text, date, confidence) => {
    const d = one(text);
    expect(d.kind).toBe('date');
    expect(d.date).toBe(date);
    expect(d.confidence).toBe(confidence);
  });

  it('rolls "the 1st" into next month when it has passed', () => {
    expect(detectCommitments('The fix will be live by the 1st.', '2026-12-05')[0]?.date).toBe('2027-01-01');
  });

  it('finds "next release" promises without a date', () => {
    const d = one('This will be fixed in the next release.');
    expect(d).toMatchObject({ kind: 'release', confidence: 'high' });
    expect(d.date).toBeUndefined();
  });

  it('finds a named release', () => {
    expect(one('The fix ships with release 2.4.').kind).toBe('release');
  });

  it('finds the promise inside a longer reply and quotes the right sentence', () => {
    const text =
      'Hi Sam,\n\nThanks for the logs, they helped a lot. We found the cause.\nWe expect the fix to be live by Thursday. I will keep you posted!';
    const d = one(text);
    expect(d.date).toBe('2026-12-03');
    expect(d.sentence).toBe('We expect the fix to be live by Thursday.');
  });

  it('returns several different promises once each', () => {
    const r = detectCommitments(
      'The SSO fix will be released by Dec 8. The export fix will be released by Dec 15. The SSO fix will be released by Dec 8.',
      REF
    );
    expect(r.map((d) => d.date)).toEqual(['2026-12-08', '2026-12-15']);
  });

  it('trims very long sentences', () => {
    const d = one(`We expect the fix by Dec 10 ${'and more words '.repeat(20)}`);
    expect(d.sentence.length).toBeLessThanOrEqual(160);
    expect(d.sentence.endsWith('…')).toBe(true);
  });
});

describe('detectCommitments: ignores non-promises', () => {
  it.each([
    'Can you send us the logs by Friday?',
    "Unfortunately we can't promise a date yet.",
    "We don't have an ETA right now, but we're on it.",
    'There is no date yet for this fix.',
    'Thanks for reaching out, we are looking into it.',
    'Your invoice from Dec 10 is attached.',
    'We fixed a similar issue on Nov 20.',
    'I was out of office yesterday.',
  ])('%s', (text) => {
    expect(detectCommitments(text, REF)).toEqual([]);
  });
});

describe('adfToText', () => {
  it('flattens comment bodies', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Hi ' }, { type: 'mention', attrs: { text: '@Sam' } }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Fix by' }, { type: 'hardBreak' }, { type: 'text', text: 'Dec 10' }] },
      ],
    };
    expect(adfToText(adf)).toBe('Hi @Sam\nFix by\nDec 10\n');
    expect(adfToText(null)).toBe('');
  });
});
