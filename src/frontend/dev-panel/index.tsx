// "Customers waiting" on a developer's work item: who was promised this fix, and by when.
import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, { Inline, Link, SectionMessage, Stack, Strong, Text } from '@forge/react';
import { formatDateWithDay, relativeDays, daysBetween } from '../../domain/dates';
import type { devView } from '../../services/chain';
import { call } from '../shared/api';
import { Card, Loading, Muted, RiskLozenge } from '../shared/ui';

type View = Awaited<ReturnType<typeof devView>>;

function App() {
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      setView(await call<View>('devView'));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 20000);
    return () => clearInterval(t);
  }, [refresh]);

  if (error) {
    return (
      <SectionMessage appearance="error" title="Kept couldn't load">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }
  if (!view) return <Loading label="Checking customer promises…" />;

  const open = view.promises.filter((p) => p.state === 'open');
  if (open.length === 0) {
    return (
      <Stack space="space.100">
        <Text>No customer is waiting on this work item.</Text>
        <Muted>When support promises a customer a fix that depends on this work item, it shows up here.</Muted>
      </Stack>
    );
  }

  return (
    <Stack space="space.150">
      <Text>
        <Strong>
          {view.waiting} {view.waiting === 1 ? 'customer is' : 'customers are'} waiting
        </Strong>
        {view.earliest ? `, the earliest promised ${formatDateWithDay(view.earliest, view.today)}.` : '.'}
      </Text>
      {view.atRisk > 0 && (
        <SectionMessage appearance="warning">
          <Text>
            The current plan misses {view.atRisk === 1 ? 'a promise' : `${view.atRisk} promises`}. Support has been told on the request.
          </Text>
        </SectionMessage>
      )}
      {open.map((p) => (
        <Card key={p.id}>
          <Stack space="space.050">
            <Inline spread="space-between" alignBlock="center">
              <Text weight="semibold">{p.customer}</Text>
              <RiskLozenge risk={p.risk} />
            </Inline>
            <Text size="small">
              Promised {formatDateWithDay(p.promisedDate, view.today)} ({relativeDays(daysBetween(view.today, p.promisedDate))})
            </Text>
            <Inline space="space.100">
              <Link href={`/browse/${p.requestKey}`} openNewTab>
                {p.requestKey}
              </Link>
              {p.expectedDate && <Muted>Fix lands {formatDateWithDay(p.expectedDate, view.today)}</Muted>}
            </Inline>
          </Stack>
        </Card>
      ))}
      <Muted>Moving this work item to another sprint or release updates these promises, and Kept tells support if one slips.</Muted>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
