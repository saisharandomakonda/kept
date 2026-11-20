// Small shared UI pieces. Everything is an Atlassian Design System component with design
// tokens, so screens match Jira (including dark mode) without custom colours.
import React from 'react';
import { Box, Inline, Lozenge, Spinner, Stack, Text, Tooltip, xcss } from '@forge/react';
import { RISK_STYLE } from '../../domain/labels';
import type { RiskLevel } from '../../domain/types';

export const styles = {
  card: xcss({
    backgroundColor: 'elevation.surface.raised',
    boxShadow: 'elevation.shadow.raised',
    borderRadius: 'radius.large',
    padding: 'space.150',
  }),
  dangerCard: xcss({
    backgroundColor: 'color.background.danger',
    borderRadius: 'radius.large',
    padding: 'space.150',
  }),
  suggestion: xcss({
    backgroundColor: 'color.background.discovery',
    borderRadius: 'radius.large',
    padding: 'space.150',
  }),
  subtle: xcss({
    backgroundColor: 'color.background.neutral.subtle',
    borderRadius: 'radius.medium',
    padding: 'space.100',
  }),
  tile: xcss({
    backgroundColor: 'elevation.surface.sunken',
    borderRadius: 'radius.large',
    padding: 'space.200',
    minWidth: '128px',
  }),
  divider: xcss({
    borderTopWidth: 'border.width',
    borderTopStyle: 'solid',
    borderTopColor: 'color.border',
    paddingTop: 'space.100',
  }),
};

export function RiskLozenge({ risk, suggested }: { risk: RiskLevel; suggested?: boolean }) {
  if (suggested) return <Lozenge appearance="discovery">Suggested</Lozenge>;
  const s = RISK_STYLE[risk];
  return (
    <Tooltip content={s.hint}>
      <Lozenge appearance={s.ui} isBold={s.bold}>
        {s.label}
      </Lozenge>
    </Tooltip>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <Inline space="space.100" alignBlock="center">
      <Spinner size="small" label={label} />
      <Text color="color.text.subtle">{label}</Text>
    </Inline>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return (
    <Text size="small" color="color.text.subtle">
      {children}
    </Text>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Stack space="space.100">
      <Text weight="semibold" size="small" color="color.text.subtle">
        {title.toUpperCase()}
      </Text>
      {children}
    </Stack>
  );
}

export function Card({ children, tone }: { children: React.ReactNode; tone?: 'danger' | 'suggestion' }) {
  const style = tone === 'danger' ? styles.dangerCard : tone === 'suggestion' ? styles.suggestion : styles.card;
  return <Box xcss={style}>{children}</Box>;
}
