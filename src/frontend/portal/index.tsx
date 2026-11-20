// Customer portal: safe fix progress on the customer's own request.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { ProgressTracker, Stack, Strong, Text } from '@forge/react';
import { formatDateWithDay } from '../../domain/dates';
import { PORTAL_STAGES, type PortalView } from '../../domain/portal';
import { call } from '../shared/api';
import { Muted } from '../shared/ui';

function App() {
  const [view, setView] = useState<PortalView | null | undefined>(undefined);

  useEffect(() => {
    call<PortalView | null>('portalView')
      .then(setView)
      .catch(() => setView(null));
  }, []);

  if (view === undefined) return <Muted>Loading fix progress…</Muted>;
  if (view === null) return <Muted>No engineering fix is linked to this request yet.</Muted>;

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
