import React from 'react';
import { SinasClient, type SinasClientOptions } from '../client/SinasClient';

const SinasContext = React.createContext<SinasClient | null>(null);

export interface SinasProviderProps {
  /** Pre-built client. If provided, options below are ignored. */
  client?: SinasClient;
  /** Standalone-mode options (baseUrl, token callbacks, etc.). */
  options?: SinasClientOptions;
  children: React.ReactNode;
}

export function SinasProvider({ client, options, children }: SinasProviderProps) {
  const value = React.useMemo(
    () => client || new SinasClient(options),
    // We intentionally only re-create when `client` reference changes; `options`
    // is expected to be a stable object (callbacks reading from localStorage).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  );
  return React.createElement(SinasContext.Provider, { value }, children);
}

export function useClient(): SinasClient {
  const client = React.useContext(SinasContext);
  if (client) return client;
  return defaultClient;
}

const defaultClient = new SinasClient();
