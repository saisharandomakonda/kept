// The Promises page: for support leads, in the JSM queue sidebar (one space) and the Apps menu (all spaces).
import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Code,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  Link,
  SectionMessage,
  Stack,
  StackBarChart,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  useProductContext,
} from '@forge/react';
import { rovo } from '@forge/bridge';
import { formatDate, relativeDays } from '../../domain/dates';
import { RISK_STYLE } from '../../domain/labels';
import { RISK_RANK } from '../../domain/risk';
import type { dashboard, DashboardRow } from '../../services/chain';
import { AGENT, call } from '../shared/api';
import { SampleCard } from '../shared/SampleCard';
import { Loading, Muted, RiskLozenge, styles } from '../shared/ui';

type Data = Awaited<ReturnType<typeof dashboard>>;

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Box xcss={styles.tile}>
      <Stack space="space.050">
        <Text size="small" color="color.text.subtle">
          {label}
        </Text>
        <Heading size="large">{value}</Heading>
        {hint && <Muted>{hint}</Muted>}
      </Stack>
    </Box>
  );
}

const head = {
  cells: [
    // Widths are percentages; keys like ENGS-123 must not wrap.
    { key: 'customer', content: 'Customer', isSortable: true, width: 12 },
    { key: 'request', content: 'Request', width: 12 },
    { key: 'promised', content: 'Promised', isSortable: true, width: 10 },
    { key: 'expected', content: 'Fix expected', width: 10 },
    { key: 'risk', content: 'Status', isSortable: true, width: 9 },
    { key: 'why', content: 'Why', width: 37 },
    { key: 'told', content: 'Customer told', width: 10 },
  ],
};

// Chart colours follow the status lozenges: green, yellow, red, grey. Charts take hex values, not tokens;
// these are the Atlassian palette's mid tones, readable in light and dark themes.
const CHART_COLOURS = [
  { key: RISK_STYLE['on-track'].label, value: '#22A06B' },
  { key: RISK_STYLE.tight.label, value: '#E2B203' },
  { key: RISK_STYLE['at-risk'].label, value: '#E2483D' },
  { key: RISK_STYLE.unplanned.label, value: '#8590A2' },
];

function rows(list: DashboardRow[], today: string) {
  return list.map((r) => ({
    key: r.id,
    cells: [
      { key: r.customer, content: <Text weight="semibold">{r.customer}</Text> },
      {
        key: r.requestKey,
        content: (
          <Link href={`/browse/${r.requestKey}`} openNewTab>
            {r.requestKey}
          </Link>
        ),
      },
      {
        key: r.promisedDate,
        content: (
          <Stack space="space.0">
            <Text>{formatDate(r.promisedDate, today)}</Text>
            <Muted>{relativeDays(r.daysLeft)}</Muted>
          </Stack>
        ),
      },
      { key: r.expectedDate ?? '', content: <Text>{r.expectedDate ? formatDate(r.expectedDate, today) : 'Not planned'}</Text> },
      // Sort by severity, not alphabetically.
      { key: String(RISK_RANK[r.risk]).padStart(2, '0'), content: r.state === 'kept' || r.state === 'kept-late' ? <RiskLozenge risk="delivered" /> : <RiskLozenge risk={r.risk} /> },
      { key: r.why, content: <Text size="small">{r.why}</Text> },
      { key: r.customerToldAt ?? '', content: <Text size="small">{r.customerToldAt ? formatDate(r.customerToldAt.slice(0, 10), today) : '—'}</Text> },
    ],
  }));
}

function App() {
  const context = useProductContext();
  const projectKey = (context?.extension as { project?: { key?: string } } | undefined)?.project?.key;
  const isQueuePage = context?.moduleKey === 'kept-queue-page';
  const [data, setData] = useState<Data>();
  const [error, setError] = useState<string>();
  const [rovoOn, setRovoOn] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await call<Data>('dashboard', isQueuePage && projectKey ? { projectKey } : {}));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [isQueuePage, projectKey]);

  useEffect(() => {
    if (!context) return;
    void refresh();
    rovo
      .isEnabled()
      .then(setRovoOn)
      .catch(() => setRovoOn(false));
  }, [context, refresh]);

  if (error) {
    return (
      <SectionMessage appearance="error" title="Kept couldn't load">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }
  if (!data) return <Loading label="Loading promises…" />;

  const attention = data.rows.filter((r) => r.risk === 'at-risk' || r.risk === 'broken' || r.risk === 'tight' || r.risk === 'unknown');
  const empty = data.rows.length === 0 && data.recent.length === 0 && data.counts.suggested === 0;

  return (
    <Stack space="space.300">
      <Inline spread="space-between" alignBlock="center">
        <Stack space="space.050">
          {/* Jira already shows the page title ("Kept" in Apps, "Promises" in the queue sidebar). */}
          <Text color="color.text.subtle">
            Every fix date support gave a customer, checked against the live developer plan{isQueuePage && projectKey ? ` for ${projectKey}` : ''}.
          </Text>
        </Stack>
        <Inline space="space.100">
          {rovoOn && (
            <Button
              onClick={() =>
                rovo.open({
                  type: 'forge',
                  agentKey: AGENT.key,
                  agentName: AGENT.name,
                  prompt: 'Which customer promises are at risk this week, and what should we tell each customer?',
                })
              }
            >
              Ask Rovo
            </Button>
          )}
          <Button appearance="subtle" onClick={() => void refresh()}>
            Refresh
          </Button>
        </Inline>
      </Inline>

      {empty ? (
        <Stack space="space.200">
          <EmptyState
            header="No promises tracked yet"
            description={
              isQueuePage
                ? 'When an agent tells a customer when a fix will land, Kept tracks it and warns the moment the developer plan slips. To try it, open Apps → Kept and load the sample scenario.'
                : 'When an agent tells a customer when a fix will land, Kept tracks it and warns the moment the developer plan slips. Load the sample scenario below to see it in action.'
            }
          />
          {!isQueuePage && <SampleCard onChange={() => void refresh()} />}
        </Stack>
      ) : (
        <Stack space="space.300">
          <Inline space="space.200" shouldWrap>
            <Tile label="Open promises" value={String(data.counts.open)} />
            <Tile label="At risk" value={String(data.counts.atRisk)} hint="Plan lands after the promise" />
            <Tile label="Broken" value={String(data.counts.broken)} hint="Date passed, not delivered" />
            <Tile label="Due in 7 days" value={String(data.counts.dueThisWeek)} />
            <Tile
              label="Kept on time"
              value={data.counts.keptRate === null ? '—' : `${data.counts.keptRate}%`}
              hint={
                data.counts.closedCount + data.counts.broken > 0
                  ? `${data.counts.keptCount} of the last ${data.counts.closedCount + data.counts.broken}`
                  : 'None closed yet'
              }
            />
            {data.counts.suggested > 0 && (
              <Tile label="Spotted in replies" value={String(data.counts.suggested)} hint="Open the request to Track or Dismiss" />
            )}
          </Inline>

          <Tabs id="kept-tabs">
            <TabList>
              <Tab>{`Needs attention (${attention.length})`}</Tab>
              <Tab>{`All open (${data.rows.length})`}</Tab>
              <Tab>{`Recently kept (${data.recent.length})`}</Tab>
            </TabList>
            <TabPanel>
              <Box xcss={styles.subtle}>
                {attention.length === 0 ? (
                  <Text>Nothing needs attention. Every open promise is on track.</Text>
                ) : (
                  <DynamicTable head={head} rows={rows(attention, data.today)} rowsPerPage={10} />
                )}
              </Box>
            </TabPanel>
            <TabPanel>
              <Box xcss={styles.subtle}>
                <DynamicTable head={head} rows={rows(data.rows, data.today)} rowsPerPage={10} emptyView={<Text>No open promises.</Text>} />
              </Box>
            </TabPanel>
            <TabPanel>
              <Box xcss={styles.subtle}>
                <DynamicTable head={head} rows={rows(data.recent, data.today)} rowsPerPage={10} emptyView={<Text>No promises closed yet.</Text>} />
              </Box>
            </TabPanel>
          </Tabs>

          <Stack space="space.100">
            <Heading size="small">Promises due by week</Heading>
            <StackBarChart
              data={data.chart}
              xAccessor="week"
              yAccessor="count"
              colorAccessor="risk"
              colorPalette={CHART_COLOURS}
              height={260}
            />
          </Stack>

          <SectionMessage appearance="information" title="Build a queue for promises at risk">
            <Stack space="space.100">
              <Text>Every request and work item with a promise gets searchable Kept fields, so you can use them in queues, filters and dashboards. For example:</Text>
              <Code>keptRisk = &quot;at-risk&quot; ORDER BY keptPromiseDate ASC</Code>
              <Text>Developers can sort their backlog by who is waiting: </Text>
              <Code>keptWaiting &gt; 0 ORDER BY keptEarliestPromise ASC</Code>
            </Stack>
          </SectionMessage>

          {!isQueuePage && <SampleCard onChange={() => void refresh()} />}
        </Stack>
      )}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
