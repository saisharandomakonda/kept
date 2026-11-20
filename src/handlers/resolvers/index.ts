import Resolver from '@forge/resolver';

const resolver = new Resolver();

resolver.define('ping', async ({ context }) => {
  return { ok: true, at: new Date().toISOString(), module: context.moduleKey ?? null };
});

export const handler = resolver.getDefinitions();
export { handler as resolver };
