// The customer portal view. Checks the viewer can see the request (as them), then reads the
// developer side as the app and returns only the customer-safe projection.
import { route } from '@forge/api';
import { portalView, type PortalView } from '../domain/portal';
import { jiraGetOptional } from '../jira/http';
import { getRequest } from '../jira/issues';
import { getSettings } from '../store/settings';
import { devItemsOf } from './chain';
import { today } from './clock';

/** Hidden: turned off, or the viewer can't see the request. Null: no engineering work is linked. */
export type PortalResult = PortalView | { hidden: true } | null;

export async function portalForRequest(requestKey: string): Promise<PortalResult> {
  const settings = await getSettings();
  if (!settings.portalEnabled) return { hidden: true };
  // Access check as the viewing customer: the JSM API only returns requests they may see.
  const visible = await jiraGetOptional<{ issueKey: string }>('user', route`/rest/servicedeskapi/request/${requestKey}`).catch(
    () => undefined
  );
  if (!visible) return { hidden: true };
  const request = await getRequest(requestKey, 'app');
  if (!request) return { hidden: true };
  const { snapshots } = await devItemsOf(request);
  return portalView([...snapshots.values()], today(), settings.portalShowDate);
}
