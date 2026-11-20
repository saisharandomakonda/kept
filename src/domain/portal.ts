// What a customer may see on the portal. Only these fields ever leave the backend for a
// customer: a stage, a short sentence, and (only if the admin allows) a planned date.
import { expectedDelivery } from './expected';
import type { DevSnapshot, IsoDate } from './types';

export const PORTAL_STAGES = ['Reported', 'Confirmed', 'In development', 'Fixed', 'Released'] as const;

export interface PortalView {
  stageIndex: number;
  stage: (typeof PORTAL_STAGES)[number];
  message: string;
  plannedDate?: IsoDate;
}

const MESSAGES = [
  'We have your report.',
  'Our engineers have confirmed the problem and planned a fix.',
  'A fix is being built.',
  'The fix is done and waiting for the next release.',
  'The fix has been released.',
];

function stageOf(dev: DevSnapshot, today: IsoDate): number {
  const e = expectedDelivery(dev, today);
  if (e.delivered) return 4;
  if (dev.statusCategory === 'done') return 3;
  if (dev.statusCategory === 'indeterminate') return 2;
  return 1;
}

/**
 * Builds the customer-safe view. With several linked work items, the customer sees the
 * least advanced one (the fix isn't complete until all parts are).
 */
export function portalView(devs: DevSnapshot[], today: IsoDate, showDate: boolean): PortalView | null {
  if (devs.length === 0) return null;
  const index = Math.min(...devs.map((d) => stageOf(d, today)));
  const view: PortalView = {
    stageIndex: index,
    stage: PORTAL_STAGES[index] as PortalView['stage'],
    message: MESSAGES[index] as string,
  };
  if (showDate && index < 4) {
    const dates = devs.map((d) => expectedDelivery(d, today).date).filter((d): d is IsoDate => !!d);
    if (dates.length === devs.length && dates.length > 0) view.plannedDate = dates.sort().at(-1);
  }
  return view;
}
