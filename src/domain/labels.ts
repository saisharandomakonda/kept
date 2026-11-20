// Display labels and Atlassian Design System lozenge appearances for each risk level.
// Shared by the UI and by the panel's dynamic status badge, so they always agree.
import type { PromiseState, RiskLevel } from './types';

export type LozengeAppearance = 'default' | 'inprogress' | 'moved' | 'new' | 'removed' | 'success';

export interface RiskStyle {
  label: string;
  appearance: LozengeAppearance;
  bold: boolean;
  /** One short phrase for tooltips and lists. */
  hint: string;
}

export const RISK_STYLE: Record<RiskLevel, RiskStyle> = {
  'on-track': { label: 'On track', appearance: 'success', bold: false, hint: 'The plan lands before the promised date' },
  tight: { label: 'Tight', appearance: 'moved', bold: false, hint: 'Little or no room before the promised date' },
  'at-risk': { label: 'At risk', appearance: 'removed', bold: true, hint: 'The current plan lands after the promised date' },
  broken: { label: 'Broken', appearance: 'removed', bold: true, hint: 'The promised date has passed' },
  unplanned: { label: 'Not planned', appearance: 'default', bold: false, hint: 'The fix has no sprint, release or due date yet' },
  delivered: { label: 'Delivered', appearance: 'success', bold: true, hint: 'The fix has reached the customer' },
  unknown: { label: 'No link', appearance: 'default', bold: false, hint: 'No developer work item is linked' },
};

export const STATE_LABEL: Record<PromiseState, string> = {
  suggested: 'Suggested',
  open: 'Open',
  kept: 'Kept',
  'kept-late': 'Kept late',
  broken: 'Broken',
  withdrawn: 'Withdrawn',
  replaced: 'Replaced',
};

export function riskLabel(risk: RiskLevel | undefined): string {
  return risk ? RISK_STYLE[risk].label : 'No promises';
}
