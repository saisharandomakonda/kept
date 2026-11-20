import { kvs } from '@forge/kvs';
import { DEFAULT_SETTINGS, type Settings } from '../domain/types';

const KEY = 'settings:v1';

export async function getSettings(): Promise<Settings> {
  const stored = await kvs.get<Partial<Settings>>(KEY);
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

export function sanitizeSettings(input: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  const int = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined);
  const b = int(input.bufferDays, 0, 30);
  if (b !== undefined) out.bufferDays = b;
  const u = int(input.unplannedWarnDays, 1, 90);
  if (u !== undefined) out.unplannedWarnDays = u;
  const n = int(input.notStartedWarnDays, 0, 30);
  if (n !== undefined) out.notStartedWarnDays = n;
  for (const k of ['noteOnRequest', 'noteOnDevIssue', 'portalEnabled', 'portalShowDate', 'detectPromises'] as const) {
    const v = bool(input[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export async function saveSettings(input: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...sanitizeSettings(input) };
  await kvs.set(KEY, next);
  return next;
}
