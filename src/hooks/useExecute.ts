import React from 'react';
import { executeFunction } from '../client/functions';
import { useClient } from './context';
import type { FunctionResult } from '../client/types';

export interface UseExecuteResult {
  execute: (input?: Record<string, unknown>, timeout?: number) => Promise<FunctionResult | undefined>;
  result: unknown;
  loading: boolean;
  error: string | null;
  executionId: string | null;
}

export function useExecute(ref: string): UseExecuteResult {
  const client = useClient();

  const [result, setResult] = React.useState<unknown>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [executionId, setExecutionId] = React.useState<string | null>(null);

  const execute = React.useCallback(
    async (input: Record<string, unknown> = {}, timeout?: number) => {
      setLoading(true);
      setError(null);
      try {
        const data = await executeFunction(client, ref, input, timeout);
        setResult(data.result);
        setExecutionId(data.executionId);
        if (data.status === 'error') {
          setError(data.error || 'Function execution failed');
        } else if (data.status === 'timeout') {
          setError('Function execution timed out');
        }
        return data;
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [client, ref]
  );

  return { execute, result, loading, error, executionId };
}
