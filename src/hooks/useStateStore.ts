import React from 'react';
import { stateGet, stateSet, stateDelete, stateList } from '../client/states';
import { useClient } from './context';
import type { StateListResult } from '../client/types';

export interface UseStateStoreOptions {
  visibility?: 'private' | 'shared';
}

export interface UseStateStoreResult {
  value: unknown;
  loading: boolean;
  error: string | null;
  save: (value: unknown, opts?: UseStateStoreOptions) => Promise<void>;
  remove: () => Promise<void>;
  refetch: () => Promise<void>;
  list: () => Promise<StateListResult | undefined>;
}

export function useStateStore(ns: string, key?: string): UseStateStoreResult {
  const client = useClient();

  const [value, setValue] = React.useState<unknown>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!key) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await stateGet(client, ns, key);
      if (result.found) {
        setValue(result.value);
      } else {
        setValue(null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [client, ns, key]);

  const save = React.useCallback(
    async (newValue: unknown, opts?: UseStateStoreOptions) => {
      if (!key) throw new Error('Cannot save without a key');
      setValue(newValue);
      setError(null);
      try {
        await stateSet(client, ns, key, newValue, opts?.visibility);
      } catch (e) {
        setError((e as Error).message);
        throw e;
      }
    },
    [client, ns, key]
  );

  const remove = React.useCallback(async () => {
    if (!key) throw new Error('Cannot delete without a key');
    setValue(null);
    setError(null);
    try {
      await stateDelete(client, ns, key);
    } catch (e) {
      setError((e as Error).message);
      throw e;
    }
  }, [client, ns, key]);

  const list = React.useCallback(async () => {
    setError(null);
    try {
      return await stateList(client, ns);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [client, ns]);

  React.useEffect(() => {
    load();
  }, [load]);

  return { value, loading, error, save, remove, refetch: load, list };
}
