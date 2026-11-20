// "Load sample scenario": builds a realistic support ↔ engineering story in two spaces you pick.
import React, { useCallback, useEffect, useState } from 'react';
import {
  Button,
  ButtonGroup,
  Inline,
  Label,
  Link,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  ProgressBar,
  SectionMessage,
  Select,
  Stack,
  Text,
} from '@forge/react';
import type { SampleStatus } from '../../services/seed';
import type { SpaceInfo } from '../../jira/projects';
import { call } from './api';
import { Card, Loading, Muted } from './ui';

type Spaces = { service: SpaceInfo[]; software: SpaceInfo[] };
type Option = { label: string; value: string };

const toOption = (s: SpaceInfo): Option => ({ label: `${s.name} (${s.key})`, value: s.key });

function pickDefault(list: SpaceInfo[], patterns: RegExp[]): SpaceInfo | undefined {
  for (const p of patterns) {
    const hit = list.find((s) => p.test(s.name) || p.test(s.key));
    if (hit) return hit;
  }
  return list[0];
}

export function SampleCard({ onChange }: { onChange?: () => void }) {
  const [status, setStatus] = useState<SampleStatus>();
  const [spaces, setSpaces] = useState<Spaces>();
  const [service, setService] = useState<string>();
  const [dev, setDev] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, sp] = await Promise.all([call<SampleStatus>('sampleStatus'), call<Spaces>('spaces')]);
      setStatus(s);
      setSpaces(sp);
      setService((v) => v ?? pickDefault(sp.service, [/engineering support/i, /support/i, /service/i])?.key);
      setDev((v) => v ?? pickDefault(sp.software, [/tally dev/i, /platform/i, /dev/i])?.key);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async () => {
    setBusy(true);
    setError(undefined);
    try {
      let s = await call<SampleStatus>('startSample', { serviceKey: service, devKey: dev });
      setStatus(s);
      while (s.state === 'running') {
        s = await call<SampleStatus>('sampleStep');
        setStatus(s);
      }
      onChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirm(false);
    setBusy(true);
    setError(undefined);
    try {
      setStatus(await call<SampleStatus>('removeSample'));
      onChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!status || !spaces) return error ? <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage> : <Loading label="Loading…" />;

  const requests = status.plan?.requests ?? [];
  return (
    <Card>
      <Stack space="space.150">
        <Text weight="semibold">Sample scenario</Text>
        {status.state === 'idle' && (
          <Stack space="space.150">
            <Text>
              Creates 5 customer requests, the developer work items they depend on, 2 sprints and 2 releases, with promises in
              different states. Everything is labelled <Text as="strong">kept-sample</Text> and can be removed in one click.
            </Text>
            <Inline space="space.200" shouldWrap>
              <Stack space="space.050">
                <Label labelFor="kept-service">Service space (support)</Label>
                <Select
                  inputId="kept-service"
                  options={spaces.service.map(toOption)}
                  value={spaces.service.filter((s) => s.key === service).map(toOption)[0]}
                  onChange={(o: Option) => setService(o.value)}
                />
              </Stack>
              <Stack space="space.050">
                <Label labelFor="kept-dev">Software space (developers)</Label>
                <Select
                  inputId="kept-dev"
                  options={spaces.software.map(toOption)}
                  value={spaces.software.filter((s) => s.key === dev).map(toOption)[0]}
                  onChange={(o: Option) => setDev(o.value)}
                />
              </Stack>
            </Inline>
            <Muted>Tip: a software space with a Scrum board shows sprints in the story. Without one, Kept uses due dates.</Muted>
            <Button appearance="primary" onClick={run} isDisabled={busy || !service || !dev}>
              Load sample scenario
            </Button>
          </Stack>
        )}
        {status.state === 'running' && (
          <Stack space="space.100">
            <ProgressBar value={status.step / status.total} ariaLabel="Creating the sample scenario" />
            <Text>{status.message}…</Text>
          </Stack>
        )}
        {status.state === 'done' && (
          <Stack space="space.100">
            <SectionMessage appearance="success" title="Sample scenario ready">
              <Stack space="space.100">
                <Text>
                  Open a request to see its promises. Try it: move the Acme bug to the next sprint and watch its request turn
                  red.
                </Text>
                <Inline space="space.100" shouldWrap>
                  {requests.map((k) => (
                    <Link key={k} href={`/browse/${k}`} openNewTab>
                      {k}
                    </Link>
                  ))}
                </Inline>
              </Stack>
            </SectionMessage>
            <ButtonGroup label="Sample actions">
              <Button appearance="subtle" onClick={() => setConfirm(true)} isDisabled={busy}>
                Remove sample data
              </Button>
            </ButtonGroup>
          </Stack>
        )}
        {status.state === 'failed' && (
          <SectionMessage appearance="error" title="The sample scenario couldn't be completed">
            <Stack space="space.100">
              <Text>{status.error}</Text>
              <Button onClick={remove} isDisabled={busy}>
                Clean up and start over
              </Button>
            </Stack>
          </SectionMessage>
        )}
        {status.error && status.state === 'idle' && (
          <SectionMessage appearance="warning">
            <Text>{status.error}</Text>
          </SectionMessage>
        )}
        {error && (
          <SectionMessage appearance="error">
            <Text>{error}</Text>
          </SectionMessage>
        )}
      </Stack>
      <ModalTransition>
        {confirm && (
          <Modal onClose={() => setConfirm(false)}>
            <ModalHeader>
              <ModalTitle appearance="danger">Remove the sample scenario?</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Text>
                This permanently deletes the {status.created.issues.length} work items, {status.created.sprints.length} sprints and{' '}
                {status.created.versions.length} releases the sample created, and their promises. Nothing else is touched.
              </Text>
            </ModalBody>
            <ModalFooter>
              <ButtonGroup label="Confirm removal">
                <Button appearance="subtle" onClick={() => setConfirm(false)}>
                  Cancel
                </Button>
                <Button appearance="danger" onClick={remove}>
                  Remove
                </Button>
              </ButtonGroup>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </Card>
  );
}
