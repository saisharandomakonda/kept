import type { DevSnapshot, SprintInfo, VersionInfo } from '../../src/domain/types';

export const TODAY = '2026-12-01';

export function dev(overrides: Partial<DevSnapshot> = {}): DevSnapshot {
  return {
    key: 'BUG-12',
    summary: 'Invoice PDF export times out',
    status: 'In Progress',
    statusCategory: 'indeterminate',
    fixVersions: [],
    sprints: [],
    projectKey: 'BUG',
    ...overrides,
  };
}

export function sprint(name: string, endDate: string, state: SprintInfo['state'] = 'active', id = 1): SprintInfo {
  return { id, name, state, endDate, startDate: '2026-11-25' };
}

export function version(name: string, releaseDate?: string, released = false, id = name): VersionInfo {
  return { id, name, releaseDate, released };
}
