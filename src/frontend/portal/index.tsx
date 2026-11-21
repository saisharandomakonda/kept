// Customer portal: safe fix progress on the customer's own request.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { ProgressTracker, Stack, Strong, Text } from '@forge/react';
import { formatDateWithDay } from '../../domain/dates';
import { PORTAL_STAGES, type PortalView } from '../../domain/portal';
import { call } from '../shared/api';
import { Muted } from '../shared/ui';

type Result = PortalView | { hidden: true } | null;

function App() {
  const [view, setView] = useState<Result | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    call<Result>('portalView')
      .then(setView)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <Muted>Fix progress couldn&apos;t load. Refresh the page to try again.</Muted>;
  if (view === undefined) return <Muted>Loading fix progress…</Muted>;
  if (view === null) return <Muted>No engineering work is linked to this request.</Muted>;
  if ('hidden' in view) return null;

  const items = PORTAL_STAGES.map((label, i) => ({
    id: String(i),
    label,
    percentageComplete: i < view.stageIndex ? 100 : 0,
    status: (i < view.stageIndex ? 'visited' : i === view.stageIndex ? 'current' : 'unvisited') as 'visited' | 'current' | 'unvisited',
  }));

  return (
    <Stack space="space.150">
      <ProgressTracker items={items} />
      <Text>
        <Strong>{view.stage}.</Strong> {view.message}
      </Text>
      {view.plannedDate && <Text>Planned for {formatDateWithDay(view.plannedDate)}.</Text>}
      <Muted>This updates automatically as our engineering team works on the fix.</Muted>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
