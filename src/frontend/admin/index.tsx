// Settings page (Jira settings → Apps → Kept).
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button,
  Inline,
  Label,
  SectionMessage,
  Stack,
  Text,
  Textfield,
  Toggle,
} from '@forge/react';
import type { Settings } from '../../domain/types';
import { call } from '../shared/api';
import { SampleCard } from '../shared/SampleCard';
import { Card, Loading, Muted } from '../shared/ui';

const TOGGLES: { key: keyof Settings; label: string; help: string }[] = [
  { key: 'noteOnRequest', label: 'Internal note on the request', help: 'When a promise gets worse, post an internal note (agents only) with what changed.' },
  { key: 'noteOnDevIssue', label: 'Heads-up on the developer work item', help: 'Tell developers which customer their change affects.' },
  { key: 'detectPromises', label: 'Spot promises in replies', help: 'Suggest a promise when an agent replies with a date ("fixed by Friday"). Rules-based, no AI credits.' },
  { key: 'portalEnabled', label: 'Show fix progress on the customer portal', help: 'On requests where support gave a date, customers see a simple stage tracker. No internal details.' },
  { key: 'portalShowDate', label: 'Show the planned date on the portal', help: 'Also show the date the fix is planned for.' },
];

function App() {
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  // Bumped after each save so the (uncontrolled) number fields show the stored values.
  const [loadNo, setLoadNo] = useState(0);

  const change = (patch: Partial<Settings>) => {
    setSaved(false);
    setSettings((s) => (s ? { ...s, ...patch } : s));
  };

  useEffect(() => {
    call<Settings>('getSettings').then(setSettings).catch((e: Error) => setError(e.message));
  }, []);

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    setSaved(false);
    setError(undefined);
    try {
      setSettings(await call<Settings>('saveSettings', settings as unknown as Record<string, unknown>));
      setLoadNo((n) => n + 1);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : <Loading label="Loading settings…" />;

  const num = (key: 'bufferDays' | 'unplannedWarnDays' | 'notStartedWarnDays', label: string, help: string) => (
    <Stack space="space.050">
      <Label labelFor={`kept-${key}`}>{label}</Label>
      {/* Uncontrolled: a controlled value drops fast typing in UI Kit. */}
      <Textfield
        key={`kept-${key}-${loadNo}`}
        id={`kept-${key}`}
        type="number"
        width={120}
        defaultValue={String(settings[key])}
        onChange={(e) => change({ [key]: Number(e.target.value) })}
      />
      <Muted>{help}</Muted>
    </Stack>
  );

  return (
    <Stack space="space.300">
      <Text color="color.text.subtle">
        Kept tracks the dates support gives customers about fixes, and warns when the developer plan slips. These settings apply to the whole site.
      </Text>

      <Card>
        <Stack space="space.200">
          <Text weight="semibold">Notifications and visibility</Text>
          {TOGGLES.map((t) => (
            <Inline key={t.key} space="space.150" alignBlock="start">
              <Toggle
                id={`kept-${t.key}`}
                isChecked={settings[t.key] as boolean}
                onChange={() => change({ [t.key]: !settings[t.key] })}
                label={t.label}
              />
              <Stack space="space.0">
                <Label labelFor={`kept-${t.key}`}>{t.label}</Label>
                <Muted>{t.help}</Muted>
              </Stack>
            </Inline>
          ))}
        </Stack>
      </Card>

      <Card>
        <Stack space="space.200">
          <Text weight="semibold">Risk rules</Text>
          {num('bufferDays', 'Safety margin (days)', 'A promise is "tight" when the fix lands less than this many days before the promised date.')}
          {num('unplannedWarnDays', 'Unplanned warning (days)', 'Warn when a promise is this close and the fix has no sprint, release or due date.')}
          {num('notStartedWarnDays', 'Not started warning (days)', 'Warn when work has not started this close to the promised date.')}
        </Stack>
      </Card>

      <Inline space="space.100" alignBlock="center">
        <Button appearance="primary" onClick={save} isDisabled={busy}>
          {busy ? 'Saving…' : 'Save settings'}
        </Button>
        {saved && <Text color="color.text.success">Saved</Text>}
      </Inline>
      {error && (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      <SampleCard />
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
