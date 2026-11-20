import React from 'react';
import ForgeReconciler, { Text } from '@forge/react';

const App = () => <Text>Kept is installed. Customer promises will appear here.</Text>;

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
