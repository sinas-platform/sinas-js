import { useClient } from './context';
import { useQuery } from './useQuery';
import { useExecute } from './useExecute';
import { useStateStore } from './useStateStore';
import { useChat } from './useChat';
import type { SinasConfig } from '../client/types';
import type { SinasClient } from '../client/SinasClient';

export interface UseSinasResult {
  config: SinasConfig;
  input: Record<string, unknown>;
  client: SinasClient;
  useQuery: typeof useQuery;
  useExecute: typeof useExecute;
  useStateStore: typeof useStateStore;
  useChat: typeof useChat;
}

export function useSinas(): UseSinasResult {
  const client = useClient();

  return {
    config: client.getConfig(),
    input: client.getInput(),
    client,
    useQuery,
    useExecute,
    useStateStore,
    useChat,
  };
}
