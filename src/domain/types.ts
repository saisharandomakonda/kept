// Shared types for Kept's pure domain logic. No Forge imports in src/domain.

/** A calendar date in YYYY-MM-DD form (no time zone). */
export type IsoDate = string;
/** A full ISO-8601 timestamp. */
export type IsoDateTime = string;

export type StatusCategory = 'new' | 'indeterminate' | 'done';

export interface SprintInfo {
  id: number;
  name: string;
  state: 'active' | 'future' | 'closed';
  startDate?: IsoDate;
  endDate?: IsoDate;
}

export interface VersionInfo {
  id: string;
  name: string;
  released: boolean;
  releaseDate?: IsoDate;
}

/** What Kept needs to know about the developer's work item. */
export interface DevSnapshot {
  key: string;
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  resolutionDate?: IsoDate;
  fixVersions: VersionInfo[];
  sprints: SprintInfo[];
  dueDate?: IsoDate;
  priority?: string;
  assigneeName?: string;
  projectKey: string;
  projectName?: string;
}

export type RiskLevel =
  | 'on-track'
  | 'tight'
  | 'at-risk'
  | 'broken'
  | 'unplanned'
  | 'delivered'
  | 'unknown';

export type PromiseState =
  | 'suggested'
  | 'open'
  | 'kept'
  | 'kept-late'
  | 'broken'
  | 'withdrawn'
  | 'replaced';

export type ExpectedSource = 'release' | 'sprint' | 'due' | 'resolved' | 'released';

export interface Evidence {
  field: string;
  from?: string | null;
  to?: string | null;
  by?: string | null;
  at?: IsoDateTime | null;
}

export interface Reason {
  code:
    | 'released'
    | 'resolved-awaiting-release'
    | 'release-after-promise'
    | 'sprint-after-promise'
    | 'due-after-promise'
    | 'sprint-after-release'
    | 'no-plan'
    | 'no-plan-soon'
    | 'not-started-soon'
    | 'tight'
    | 'past-promise'
    | 'on-track'
    | 'delivered-late'
    | 'no-dev-item'
    | 'recent-change';
  severity: 'info' | 'warning' | 'danger' | 'success';
  message: string;
  evidence?: Evidence;
}

export interface Expected {
  date?: IsoDate;
  source?: ExpectedSource;
  /** True once the fix is done and has reached customers (or needs no release). */
  delivered: boolean;
  deliveredAt?: IsoDate;
  /** Extra notes found while working out the date (e.g. the sprint ends after the release). */
  notes: Reason[];
}

export interface Assessment {
  risk: RiskLevel;
  /** Sort order: higher is worse. */
  rank: number;
  expected: Expected;
  reasons: Reason[];
  /** Whole days between the promised date and the expected date (positive = late). */
  gapDays?: number;
  /** Whole days from today until the promised date (negative = in the past). */
  daysLeft: number;
}

export interface HistoryEvent {
  at: IsoDateTime;
  type: 'made' | 'risk' | 'customer-told' | 're-promised' | 'kept' | 'broken' | 'withdrawn' | 'suggested' | 'accepted';
  text: string;
  by?: string;
}

export interface PromiseRecord {
  id: string;
  requestKey: string;
  requestId?: string;
  projectKey: string;
  devIssueKey?: string;
  customer: string;
  promisedDate: IsoDate;
  text: string;
  source: 'manual' | 'detected' | 'rovo' | 'sample';
  sourceCommentId?: string;
  madeBy?: string;
  madeAt: IsoDateTime;
  state: PromiseState;
  risk: RiskLevel;
  riskRank: number;
  expectedDate?: IsoDate;
  expectedSource?: ExpectedSource;
  reasons: Reason[];
  lastAlertedRisk?: RiskLevel;
  customerToldAt?: IsoDateTime;
  history: HistoryEvent[];
  replacedBy?: string;
  replaces?: string;
  updatedAt: IsoDateTime;
}

export interface Settings {
  bufferDays: number;
  unplannedWarnDays: number;
  notStartedWarnDays: number;
  noteOnRequest: boolean;
  noteOnDevIssue: boolean;
  portalEnabled: boolean;
  portalShowDate: boolean;
  detectPromises: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  bufferDays: 2,
  unplannedWarnDays: 14,
  notStartedWarnDays: 3,
  noteOnRequest: true,
  noteOnDevIssue: true,
  portalEnabled: true,
  portalShowDate: false,
  detectPromises: true,
};
