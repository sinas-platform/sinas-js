import React from 'react';
import { executeQuery } from '../client/queries';
import { useClient } from './context';
import type { QueryResult } from '../client/types';

export interface UseQueryOptions {
  enabled?: boolean;
  refetchInterval?: number | null;
}

export interface UseQueryResult {
  data: Record<string, unknown>[] | null;
  loading: boolean;
  error: string | null;
  rowCount: number | null;
  refetch: (overrideInput?: Record<string, unknown>) => Promise<QueryResult | undefined>;
}

export function useQuery(
  ref: string,
  input: Record<string, unknown> = {},
  options: UseQueryOptions = {}
): UseQueryResult {
  const client = useClient();
  const { enabled = true, refetchInterval = null } = options;

  const [data, setData] = React.useState<Record<string, unknown>[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rowCount, setRowCount] = React.useState<number | null>(null);

  const abortRef = React.useRef<AbortController | null>(null);
  const inputJson = JSON.stringify(input);

  const execute = React.useCallback(
    async (overrideInput?: Record<string, unknown>) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      try {
        const result = await executeQuery(
          client,
          ref,
          overrideInput || JSON.parse(inputJson)
        );
        if (!controller.signal.aborted) {
          setData(result.data || null);
          setRowCount(result.rowCount ?? result.affectedRows ?? null);
        }
        return result;
      } catch (e) {
        if (!controller.signal.aborted) {
          setError((e as Error).message);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    },
    [client, ref, inputJson]
  );

  React.useEffect(() => {
    if (enabled) {
      execute();
    }
    return () => {
      abortRef.current?.abort();
    };
  }, [enabled, execute]);

  React.useEffect(() => {
    if (refetchInterval && enabled) {
      const id = setInterval(execute, refetchInterval);
      return () => clearInterval(id);
    }
  }, [refetchInterval, enabled, execute]);

  return { data, loading, error, rowCount, refetch: execute };
}
