import { toIsoDate } from '../domain/dates';

/** Today's calendar date (UTC), as YYYY-MM-DD. */
export const today = (): string => toIsoDate(new Date()) as string;
