import React from 'react';
import ForgeReconciler, { Heading, Stack, Text } from '@forge/react';

const App = () => (
  <Stack space="space.100">
    <Heading size="medium">Kept</Heading>
    <Text>Customer promises, kept. The dashboard is coming next.</Text>
  </Stack>
);

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
