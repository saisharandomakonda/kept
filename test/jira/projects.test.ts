// Board detection for the sample scenario: which boards can hold sprints.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiModule, jira, kvsModule } from '../mocks/fakes';

vi.mock('@forge/kvs', () => kvsModule);
vi.mock('@forge/api', () => apiModule);

const { sprintBoards } = await import('../../src/jira/projects');

describe('sprintBoards', () => {
  beforeEach(() => jira.reset());

  it('finds a company-managed Scrum board', async () => {
    jira.boards = [{ id: 1, name: 'BUG board', type: 'scrum', projectKey: 'BUG', sprints: true }];
    expect((await sprintBoards('BUG')).map((b) => b.id)).toEqual([1]);
  });

  it('finds a team-managed board with sprints on (Jira reports it as "simple")', async () => {
    jira.boards = [{ id: 3, name: 'DEV board', type: 'simple', projectKey: 'DEV', sprints: true }];
    expect((await sprintBoards('DEV')).map((b) => b.id)).toEqual([3]);
  });

  it('skips Kanban boards, team-managed or company-managed', async () => {
    jira.boards = [
      { id: 1, name: 'KAN board', type: 'simple', projectKey: 'KAN', sprints: false },
      { id: 2, name: 'Ops board', type: 'kanban', projectKey: 'KAN', sprints: false },
    ];
    expect(await sprintBoards('KAN')).toEqual([]);
  });

  it('ignores boards from other spaces', async () => {
    jira.boards = [{ id: 1, name: 'BUG board', type: 'scrum', projectKey: 'BUG', sprints: true }];
    expect(await sprintBoards('DEV')).toEqual([]);
  });
});
