import React from 'react';
import { SinasClient } from '../client/SinasClient';

const SinasContext = React.createContext<SinasClient | null>(null);

export interface SinasProviderProps {
  client?: SinasClient;
  children: React.ReactNode;
}

export function SinasProvider({ client, children }: SinasProviderProps) {
  const value = React.useMemo(() => client || new SinasClient(), [client]);
  return React.createElement(SinasContext.Provider, { value }, children);
}

export function useClient(): SinasClient {
  const client = React.useContext(SinasContext);
  if (client) return client;
  // Fallback: create a default client using window globals
  return defaultClient;
}

const defaultClient = new SinasClient();
