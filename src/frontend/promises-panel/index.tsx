import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  ButtonGroup,
  DatePicker,
  ErrorMessage,
  Form,
  FormFooter,
  HelperMessage,
  Inline,
  Label,
  Link,
  List,
  ListItem,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  SectionMessage,
  Select,
  Stack,
  Strong,
  Text,
  TextArea,
  Textfield,
} from '@forge/react';
import { rovo } from '@forge/bridge';
import { daysBetween, formatDateWithDay, relativeDays } from '../../domain/dates';
import { looksInternal } from '../../domain/draft';
import type { PromiseRecord } from '../../domain/types';
import type { requestView } from '../../services/chain';
import { AGENT, call } from '../shared/api';
import { Card, Loading, Muted, RiskLozenge, Section } from '../shared/ui';

type View = Extract<Awaited<ReturnType<typeof requestView>>, { found: true }>;
type Draft = { text: string; newDate?: string; suggestedDate?: string; risk: string };

const STATE_LABEL: Record<PromiseRecord['state'], { label: string; appearance: 'success' | 'warning' | 'danger' | 'neutral' | 'discovery' }> = {
  suggested: { label: 'Suggested', appearance: 'discovery' },
  open: { label: 'Open', appearance: 'neutral' },
  kept: { label: 'Kept', appearance: 'success' },
  'kept-late': { label: 'Kept late', appearance: 'warning' },
  broken: { label: 'Broken', appearance: 'danger' },
  withdrawn: { label: 'Withdrawn', appearance: 'neutral' },
  replaced: { label: 'Replaced', appearance: 'neutral' },
};

const SOURCE_LABEL: Record<PromiseRecord['source'], string> = {
  manual: 'Tracked by hand',
  detected: 'Spotted in a reply',
  rovo: 'Tracked by Rovo',
  sample: 'Sample scenario',
};

function PromiseCard({
  p,
  today,
  onWithdraw,
}: {
  p: PromiseRecord;
  today: string;
  onWithdraw: (id: string) => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const closed = p.state !== 'open';
  const left = daysBetween(today, p.promisedDate);
  const why = p.reasons.filter((r) => r.code !== 'recent-change');
  const changes = p.reasons.filter((r) => r.code === 'recent-change');
  const danger = !closed && (p.risk === 'at-risk' || p.risk === 'broken');
  return (
    <Card tone={danger ? 'danger' : undefined}>
      <Stack space="space.100">
        <Inline spread="space-between" alignBlock="center" shouldWrap space="space.050">
          <Text weight="semibold">{p.customer}</Text>
          {closed ? <Lozenge appearance={STATE_LABEL[p.state].appearance}>{STATE_LABEL[p.state].label}</Lozenge> : <RiskLozenge risk={p.risk} />}
        </Inline>
        <Text>
          Promised <Strong>{formatDateWithDay(p.promisedDate, today)}</Strong>
          {!closed && ` · ${relativeDays(left)}`}
        </Text>
        {p.text && <Muted>&ldquo;{p.text}&rdquo;</Muted>}
        {!closed && p.expectedDate && p.risk !== 'delivered' && (
          <Text size="small">
            Fix expected <Strong>{formatDateWithDay(p.expectedDate, today)}</Strong>
            {p.expectedSource ? ` (from the ${p.expectedSource === 'sprint' ? 'sprint end' : p.expectedSource === 'due' ? 'due date' : 'release date'})` : ''}
          </Text>
        )}
        {why.length > 0 && (
          <List type="unordered">
            {why.slice(0, 3).map((r, i) => (
              <ListItem key={i}>
                <Text size="small">{r.message}</Text>
              </ListItem>
            ))}
          </List>
        )}
        {changes.length > 0 && (
          <Stack space="space.050">
            <Text size="small" weight="semibold">
              What changed
            </Text>
            {changes.map((c, i) => (
              <Text key={i} size="small">
                {c.message}
              </Text>
            ))}
          </Stack>
        )}
        {p.customerToldAt && <Muted>Customer updated {formatDateWithDay(p.customerToldAt.slice(0, 10), today)}</Muted>}
        <Inline space="space.100" alignBlock="center">
          <Muted>
            {SOURCE_LABEL[p.source]}
            {p.devIssueKey ? ` · depends on ${p.devIssueKey}` : ''}
          </Muted>
        </Inline>
        {confirming ? (
          <Stack space="space.050">
            <Text size="small">Withdraw this promise? Kept stops following it. The customer isn&apos;t told.</Text>
            <Inline space="space.050" shouldWrap>
              <Button spacing="compact" appearance="warning" onClick={() => onWithdraw(p.id)}>
                Withdraw
              </Button>
              <Button spacing="compact" appearance="subtle" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </Inline>
          </Stack>
        ) : (
          <Inline space="space.050" shouldWrap>
            <Button spacing="compact" appearance="subtle" onClick={() => setShowHistory(!showHistory)}>
              {showHistory ? 'Hide history' : 'History'}
            </Button>
            {!closed && (
              <Button spacing="compact" appearance="subtle" onClick={() => setConfirming(true)}>
                Withdraw
              </Button>
            )}
          </Inline>
        )}
        {showHistory && (
          <Stack space="space.050">
            {[...p.history].reverse().map((h, i) => (
              <Text key={i} size="small">
                <Strong>{formatDateWithDay(h.at.slice(0, 10), today)}</Strong> {h.text}
              </Text>
            ))}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}

function SuggestionCard({
  p,
  today,
  onAccept,
  onDismiss,
}: {
  p: PromiseRecord;
  today: string;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <Card tone="suggestion">
      <Stack space="space.100">
        <Inline spread="space-between" alignBlock="center">
          <Text weight="semibold">Kept spotted a promise</Text>
          <Lozenge appearance="discovery">Suggested</Lozenge>
        </Inline>
        <Text size="small">&ldquo;{p.text}&rdquo;</Text>
        <Text>
          Track it as <Strong>{formatDateWithDay(p.promisedDate, today)}</Strong> for {p.customer}?
        </Text>
        <Inline space="space.100" shouldWrap>
          <Button appearance="primary" spacing="compact" onClick={() => onAccept(p.id)}>
            Track
          </Button>
          <Button appearance="subtle" spacing="compact" onClick={() => onDismiss(p.id)}>
            Dismiss
          </Button>
        </Inline>
      </Stack>
    </Card>
  );
}

function TrackModal({ view, onClose, onDone }: { view: View; onClose: () => void; onDone: () => void }) {
  const [date, setDate] = useState('');
  const [text, setText] = useState('');
  const [customer, setCustomer] = useState(view.request.customer);
  const [dev, setDev] = useState<string | undefined>(view.devItems[0]?.key);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!date) return setError('Pick the date you promised.');
    setBusy(true);
    setError(undefined);
    try {
      await call('trackPromise', { promisedDate: date, text, customer, devIssueKey: dev });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <Form onSubmit={submit}>
        <ModalHeader>
          <ModalTitle>Track a promise</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Stack space="space.150">
            <Text>Record what you told the customer. Kept checks it against the developer&apos;s plan from now on.</Text>
            <Stack space="space.050">
              <Label labelFor="kept-date">Promised date</Label>
              <DatePicker id="kept-date" value={date} onChange={(v: string) => setDate(v)} minDate={view.today} placeholder="Select the date you gave" />
            </Stack>
            {/* Text fields are uncontrolled: UI Kit round-trips each keystroke, and a controlled value drops fast typing. */}
            <Stack space="space.050">
              <Label labelFor="kept-text">What you promised (optional)</Label>
              <TextArea id="kept-text" defaultValue="" onChange={(e) => setText(String(e.target.value ?? ''))} placeholder="We expect the fix in the next release" />
            </Stack>
            <Stack space="space.050">
              <Label labelFor="kept-customer">Customer</Label>
              <Textfield id="kept-customer" defaultValue={view.request.customer} onChange={(e) => setCustomer(String(e.target.value ?? ''))} />
            </Stack>
            {view.devItems.length > 1 && (
              <Stack space="space.050">
                <Label labelFor="kept-dev">Depends on</Label>
                <Select
                  inputId="kept-dev"
                  options={view.devItems.map((d) => ({ label: `${d.key} · ${d.summary}`, value: d.key }))}
                  value={view.devItems.filter((d) => d.key === dev).map((d) => ({ label: `${d.key} · ${d.summary}`, value: d.key }))[0]}
                  onChange={(o: { value: string }) => setDev(o.value)}
                />
              </Stack>
            )}
            {view.devItems.length === 0 && (
              <HelperMessage>No developer work item is linked yet. Link one so Kept can follow the fix.</HelperMessage>
            )}
            {error && <ErrorMessage>{error}</ErrorMessage>}
          </Stack>
        </ModalBody>
        <ModalFooter>
          <FormFooter>
            <ButtonGroup label="Track actions">
              <Button appearance="subtle" onClick={onClose}>
                Cancel
              </Button>
              <Button appearance="primary" type="submit" isDisabled={busy}>
                {busy ? 'Tracking…' : 'Track promise'}
              </Button>
            </ButtonGroup>
          </FormFooter>
        </ModalFooter>
      </Form>
    </Modal>
  );
}

function DraftModal({ view, onClose, onDone }: { view: View; onClose: () => void; onDone: () => void }) {
  const [draft, setDraft] = useState<Draft>();
  const [text, setText] = useState('');
  const [newDate, setNewDate] = useState<string>('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Bumped on every new draft so the (uncontrolled) message field shows the fresh text.
  const [draftNo, setDraftNo] = useState(0);
  // Once the agent edits the message, a new date no longer overwrites their words.
  const [edited, setEdited] = useState(false);

  const load = useCallback(async (date?: string) => {
    try {
      const d = await call<Draft>('draftUpdate', date ? { newDate: date } : {});
      setDraft(d);
      setText(d.text);
      setDraftNo((n) => n + 1);
      setEdited(false);
      setNewDate(d.newDate ?? '');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await call('sendUpdate', { message: text, newDate: newDate || undefined });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const internal = looksInternal(text);
  return (
    <Modal onClose={onClose} width="large">
      <ModalHeader>
        <ModalTitle>Update the customer</ModalTitle>
      </ModalHeader>
      <ModalBody>
        {!draft && !error && <Loading label="Drafting an honest update…" />}
        {draft && (
          <Stack space="space.150">
            <Text>
              Edit the message, then send it as a reply to the customer. If you share a new date, Kept tracks it as the new promise.
            </Text>
            <Stack space="space.050">
              <Label labelFor="kept-new-date">New date to promise (optional)</Label>
              <Inline space="space.100" alignBlock="center">
                <DatePicker
                  id="kept-new-date"
                  value={newDate}
                  minDate={view.today}
                  placeholder="No new date"
                  onChange={(v: string) => {
                    setNewDate(v);
                    if (!edited) void load(v);
                  }}
                />
                {draft.suggestedDate && <Muted>Plan says {formatDateWithDay(draft.suggestedDate, view.today)} at the earliest</Muted>}
              </Inline>
              {edited && newDate !== (draft.newDate ?? '') && (
                <Inline space="space.100" alignBlock="center" shouldWrap>
                  <Muted>You edited the message, so it still has the old wording.</Muted>
                  <Button spacing="compact" onClick={() => void load(newDate || undefined)}>
                    Rewrite for this date
                  </Button>
                </Inline>
              )}
            </Stack>
            <Stack space="space.050">
              <Label labelFor="kept-message">Message to the customer</Label>
              <TextArea
                key={`kept-message-${draftNo}`}
                id="kept-message"
                defaultValue={text}
                minimumRows={10}
                onChange={(e) => {
                  setText(String(e.target.value ?? ''));
                  setEdited(true);
                }}
              />
            </Stack>
            {internal && (
              <SectionMessage appearance="warning" title="Check for internal details">
                <Text>The message seems to mention a work item key, sprint or backlog. Customers usually shouldn&apos;t see those.</Text>
              </SectionMessage>
            )}
          </Stack>
        )}
        {error && <ErrorMessage>{error}</ErrorMessage>}
      </ModalBody>
      <ModalFooter>
        <ButtonGroup label="Update actions">
          <Button appearance="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button appearance="primary" onClick={send} isDisabled={!draft || busy || text.trim().length < 10}>
            {busy ? 'Sending…' : 'Send to customer'}
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </Modal>
  );
}

function App() {
  const [view, setView] = useState<View>();
  const [error, setError] = useState<string>();
  const [modal, setModal] = useState<'track' | 'draft'>();
  const [notice, setNotice] = useState<string>();
  const [rovoOn, setRovoOn] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const v = await call<Awaited<ReturnType<typeof requestView>>>('requestView');
      if (!v.found) setError("This request couldn't be loaded.");
      else {
        setView(v);
        setError(undefined);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    rovo
      .isEnabled()
      .then(setRovoOn)
      .catch(() => setRovoOn(false));
    // Keep the panel live while it's open: developer changes show up without a reload.
    const t = setInterval(() => void refresh(), 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (name: string, payload: Record<string, unknown>, message: string) => {
    try {
      await call(name, payload);
      setNotice(message);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const askRovo = (prompt: string) =>
    rovo.open({ type: 'forge', agentKey: AGENT.key, agentName: AGENT.name, prompt }).catch(() => setRovoOn(false));

  if (error && !view) return <SectionMessage appearance="error" title="Kept couldn't load">{<Text>{error}</Text>}</SectionMessage>;
  if (!view) return <Loading label="Loading promises…" />;

  const open = view.promises.filter((p) => p.state === 'open');
  const suggested = view.promises.filter((p) => p.state === 'suggested');
  const closed = view.promises.filter((p) => p.state !== 'open' && p.state !== 'suggested');
  const worst = [...open].sort((a, b) => b.riskRank - a.riskRank)[0];
  const alarm = worst && (worst.risk === 'at-risk' || worst.risk === 'broken');
  const key = view.request.key;

  return (
    <Stack space="space.200">
      {notice && (
        <SectionMessage appearance="success">
          <Text>{notice}</Text>
        </SectionMessage>
      )}
      {error && (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {alarm && worst && (
        <SectionMessage appearance="error" title={worst.risk === 'broken' ? 'A promise to this customer was broken' : 'A promise to this customer is at risk'}>
          <Stack space="space.100">
            <Text>{worst.reasons[0]?.message}</Text>
            <Inline space="space.100" shouldWrap>
              <Button appearance="primary" spacing="compact" onClick={() => setModal('draft')}>
                Draft update
              </Button>
              {rovoOn && (
                <Button
                  spacing="compact"
                  onClick={() => askRovo(`Draft an honest update for the customer on ${key}. Explain what changed and propose a realistic new date.`)}
                >
                  Ask Rovo
                </Button>
              )}
            </Inline>
          </Stack>
        </SectionMessage>
      )}

      {suggested.map((p) => (
        <SuggestionCard
          key={p.id}
          p={p}
          today={view.today}
          onAccept={(id) => act('acceptSuggestion', { id }, 'Promise tracked. Kept will warn you if the plan slips.')}
          onDismiss={(id) => act('dismissPromise', { id }, 'Suggestion dismissed.')}
        />
      ))}

      {open.length === 0 && suggested.length === 0 && (
        <Stack space="space.100">
          <Text>No promises tracked on this request yet.</Text>
          <Muted>
            When you tell a customer when a fix will land, track it here. Kept follows the developer&apos;s work item and warns you if the plan slips.
          </Muted>
        </Stack>
      )}

      {open.map((p) => (
        <PromiseCard key={p.id} p={p} today={view.today} onWithdraw={(id) => act('dismissPromise', { id }, 'Promise withdrawn.')} />
      ))}

      <Inline space="space.100" shouldWrap>
        <Button appearance={open.length === 0 ? 'primary' : 'default'} onClick={() => setModal('track')}>
          Track a promise
        </Button>
        {open.length > 0 && !alarm && <Button onClick={() => setModal('draft')}>Update customer</Button>}
        {rovoOn && !alarm && (
          <Button appearance="subtle" onClick={() => askRovo(`What's the status of the fix behind ${key}, and are any promises to the customer at risk?`)}>
            Ask Rovo
          </Button>
        )}
      </Inline>

      <Section title="Developer work">
        {view.devItems.length === 0 ? (
          <Muted>No developer work item linked. Link the bug or story the fix depends on.</Muted>
        ) : (
          view.devItems.map((d) => (
            <Box key={d.key}>
              <Stack space="space.050">
                <Inline space="space.100" alignBlock="center">
                  <Link href={`/browse/${d.key}`} openNewTab>
                    {d.key}
                  </Link>
                  <Lozenge appearance={d.statusCategory === 'done' ? 'success' : d.statusCategory === 'indeterminate' ? 'information' : 'neutral'}>
                    {d.status}
                  </Lozenge>
                </Inline>
                <Text size="small">{d.summary}</Text>
                <Muted>
                  {d.plan}
                  {d.assignee ? ` · ${d.assignee}` : ' · Unassigned'}
                </Muted>
              </Stack>
            </Box>
          ))
        )}
      </Section>

      {closed.length > 0 && (
        <Section title="Earlier promises">
          {closed.map((p) => (
            <PromiseCard key={p.id} p={p} today={view.today} onWithdraw={() => undefined} />
          ))}
        </Section>
      )}

      <Stack space="space.050">
        <Muted>Kept re-checks on every change to the linked work.</Muted>
        <Inline>
          <Button appearance="subtle" spacing="compact" onClick={() => act('recheck', {}, 'Re-checked against the latest plan.')}>
            Re-check now
          </Button>
        </Inline>
      </Stack>

      <ModalTransition>
        {modal === 'track' && (
          <TrackModal
            view={view}
            onClose={() => setModal(undefined)}
            onDone={() => {
              setModal(undefined);
              setNotice('Promise tracked. Kept will warn you if the plan slips.');
              void refresh();
            }}
          />
        )}
        {modal === 'draft' && (
          <DraftModal
            view={view}
            onClose={() => setModal(undefined)}
            onDone={() => {
              setModal(undefined);
              setNotice('Update sent to the customer.');
              void refresh();
            }}
          />
        )}
      </ModalTransition>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
