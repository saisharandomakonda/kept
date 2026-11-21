// What the signed-in person may see. Kept stores promises from every space in one place, so every
// read made for a person (Promises page, Rovo) is filtered to the spaces they can browse.
import { route } from '@forge/api';
import { jiraGetOptional } from './http';

type Permissions = { permissions?: Record<string, { havePermission?: boolean }> };

/** The subset of these space keys the current user can browse. Unknown or failing keys are left out. */
export async function browsableSpaces(projectKeys: Iterable<string>): Promise<Set<string>> {
  const keys = [...new Set(projectKeys)].filter(Boolean).slice(0, 100);
  const visible = await Promise.all(
    keys.map(async (key) => {
      try {
        const res = await jiraGetOptional<Permissions>('user', route`/rest/api/3/mypermissions?projectKey=${key}&permissions=BROWSE_PROJECTS`);
        return res?.permissions?.BROWSE_PROJECTS?.havePermission ? key : undefined;
      } catch {
        return undefined;
      }
    })
  );
  return new Set(visible.filter((k): k is string => !!k));
}

/** True when the current user can open this work item. */
export async function canSeeWorkItem(key: string): Promise<boolean> {
  try {
    return !!(await jiraGetOptional('user', route`/rest/api/3/issue/${key}?fields=summary`));
  } catch {
    return false;
  }
}
