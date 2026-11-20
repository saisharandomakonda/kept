import { invoke } from '@forge/bridge';

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string };

/** Calls a resolver. Throws an Error with a user-friendly message when it fails. */
export async function call<T>(name: string, payload?: Record<string, unknown>): Promise<T> {
  const res = (await invoke(name, payload ?? {})) as Envelope<T>;
  if (!res || res.ok !== true) throw new Error((res as { error?: string })?.error ?? 'Something went wrong.');
  return res.data;
}

export const AGENT = { key: 'kept-agent', name: 'Kept' } as const;
